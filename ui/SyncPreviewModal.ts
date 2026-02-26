import { App, ButtonComponent, Modal, Notice } from "obsidian";
import {
	FileSyncDecision,
	SyncAction,
	SyncPreviewFileContent,
} from "../sync/SyncTypes";

const MAX_ITEMS_PER_SECTION = 120;
const MAX_RENDER_DIFF_ROWS = 800;
const MAX_LCS_CELLS = 2_000_000;

type SyncPreviewModalOptions = {
	loadPreview: () => Promise<FileSyncDecision[]>;
	loadFileContent: (filePath: string) => Promise<SyncPreviewFileContent>;
	runSync: () => Promise<void>;
};

type DecisionGroup = {
	action: SyncAction;
	title: string;
	direction: string;
	shortLabel: string;
	items: FileSyncDecision[];
};

type DiffRowType = "context" | "add" | "remove" | "modify";

type DiffRow = {
	type: DiffRowType;
	leftNo: number | null;
	leftText: string;
	rightNo: number | null;
	rightText: string;
};

type DiffOp = {
	type: "context" | "add" | "remove";
	text: string;
};

export class SyncPreviewModal extends Modal {
	private decisions: FileSyncDecision[] = [];
	private loading = false;
	private syncing = false;
	private loadError: string | null = null;
	private selectedFilePath: string | null = null;
	private selectedDecision: FileSyncDecision | null = null;
	private contentLoading = false;
	private contentError: string | null = null;
	private contentCache = new Map<string, SyncPreviewFileContent>();
	private selectedContent: SyncPreviewFileContent | null = null;

	constructor(app: App, private options: SyncPreviewModalOptions) {
		super(app);
	}

	onOpen(): void {
		void this.refreshPreview();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("kisss3-sync-preview");

		const headerEl = contentEl.createDiv({ cls: "kisss3-sync-preview-header" });
		headerEl.createEl("h2", { text: "Sync preview" });

		const actionable = this.decisions.filter(
			(d) => d.action !== SyncAction.DO_NOTHING,
		);
		const titleMeta = headerEl.createDiv({ cls: "kisss3-sync-preview-title-meta" });
		titleMeta.setText(
			this.syncing
				? "Syncing..."
				: this.loading
					? "Loading..."
					: `${actionable.length} changes`,
		);

		const actionsEl = headerEl.createDiv({ cls: "kisss3-sync-preview-actions" });
		new ButtonComponent(actionsEl)
			.setButtonText("Refresh")
			.setDisabled(this.loading || this.syncing)
			.onClick(() => {
				void this.refreshPreview();
			});
		new ButtonComponent(actionsEl)
			.setButtonText(this.syncing ? "Syncing..." : "Sync now")
			.setCta()
			.setDisabled(this.loading || this.syncing || actionable.length === 0)
			.onClick(() => {
				void this.syncAndRefresh();
			});

		if (this.loadError) {
			contentEl.createEl("p", {
				cls: "kisss3-sync-preview-error",
				text: this.loadError,
			});
			return;
		}

		if (actionable.length === 0) {
			contentEl.createEl("p", {
				cls: "kisss3-sync-preview-empty",
				text: "No changes detected. Local and remote are in sync.",
			});
			return;
		}

		const groups = this.buildDecisionGroups(actionable);

		const legendEl = contentEl.createDiv({ cls: "kisss3-sync-preview-legend" });
		legendEl.createEl("span", {
			cls: "kisss3-sync-preview-legend-title",
			text: "Legend",
		});
		for (const group of groups) {
			const token = legendEl.createEl("span", {
				cls: `kisss3-sync-preview-legend-item is-${group.action.toLowerCase()}`,
			});
			token.createEl("code", { text: group.shortLabel });
			token.createSpan({ text: `${group.direction}` });
		}

		const summaryEl = contentEl.createDiv({ cls: "kisss3-sync-preview-summary" });
		summaryEl.createEl("span", {
			cls: "kisss3-sync-preview-badge is-total",
			text: `Total ${actionable.length}`,
		});

		for (const group of groups) {
			if (group.items.length === 0) continue;
			summaryEl.createEl("span", {
				cls: `kisss3-sync-preview-badge is-${group.action.toLowerCase()}`,
				text: `${group.shortLabel} ${group.items.length}`,
			});
		}

		for (const group of groups) {
			if (group.items.length === 0) continue;

			group.items.sort((a, b) => a.filePath.localeCompare(b.filePath));

			const sectionEl = contentEl.createEl("details", {
				cls: `kisss3-sync-preview-group is-${group.action.toLowerCase()}`,
			});
			sectionEl.setAttr("open", "true");

			const sectionSummary = sectionEl.createEl("summary", {
				cls: "kisss3-sync-preview-group-summary",
			});
			sectionSummary.createEl("span", {
				cls: "kisss3-sync-preview-group-label",
				text: group.shortLabel,
			});
			sectionSummary.createEl("span", {
				text: `${group.title}`,
			});
			sectionSummary.createEl("span", {
				cls: "kisss3-sync-preview-group-direction",
				text: group.direction,
			});
			sectionSummary.createEl("span", {
				cls: "kisss3-sync-preview-group-count",
				text: `${group.items.length}`,
			});

			const ul = sectionEl.createEl("ul", {
				cls: "kisss3-sync-preview-list",
			});
			for (const item of group.items.slice(0, MAX_ITEMS_PER_SECTION)) {
				const li = ul.createEl("li", { cls: "kisss3-sync-preview-list-item" });
				const button = li.createEl("button", {
					cls: "kisss3-sync-preview-list-button",
				});
				if (this.selectedFilePath === item.filePath) {
					button.addClass("is-selected");
				}
				button.createEl("code", { text: item.filePath });
				button.addEventListener("click", () => {
					void this.selectFile(item);
				});
			}

			if (group.items.length > MAX_ITEMS_PER_SECTION) {
				sectionEl.createEl("p", {
					cls: "kisss3-sync-preview-truncated",
					text: `...and ${group.items.length - MAX_ITEMS_PER_SECTION} more`,
				});
			}
		}

		this.renderDiffPanel(contentEl);
	}

	private renderDiffPanel(contentEl: HTMLElement): void {
		const panel = contentEl.createDiv({ cls: "kisss3-diff-panel" });
		const panelHeader = panel.createDiv({ cls: "kisss3-diff-panel-header" });
		panelHeader.createEl("h3", { text: "Line diff" });

		if (this.selectedDecision) {
			const meta = panelHeader.createDiv({ cls: "kisss3-diff-panel-meta" });
			meta.setText(
				`${this.getActionTitle(this.selectedDecision.action)} | ${this.selectedDecision.filePath}`,
			);
		}

		if (!this.selectedDecision) {
			panel.createEl("p", {
				cls: "kisss3-diff-empty",
				text: "Select a file from the change list to inspect line-level differences.",
			});
			return;
		}

		if (this.contentLoading) {
			panel.createEl("p", {
				cls: "kisss3-diff-empty",
				text: "Loading file content...",
			});
			return;
		}

		if (this.contentError) {
			panel.createEl("p", {
				cls: "kisss3-sync-preview-error",
				text: this.contentError,
			});
			return;
		}

		if (!this.selectedContent) {
			panel.createEl("p", {
				cls: "kisss3-diff-empty",
				text: "No diff content available.",
			});
			return;
		}

		const { rows, truncated } = this.buildDiffRows(
			this.selectedContent.localText,
			this.selectedContent.remoteText,
		);
		if (rows.length === 0) {
			panel.createEl("p", {
				cls: "kisss3-diff-empty",
				text: "No line differences detected.",
			});
			return;
		}

		const columns = panel.createDiv({ cls: "kisss3-diff-columns" });
		columns.createDiv({ cls: "kisss3-diff-column-title" }).setText("Local");
		columns.createDiv({ cls: "kisss3-diff-column-title" }).setText("Remote");

		const grid = panel.createDiv({ cls: "kisss3-diff-grid" });
		for (const row of rows) {
			const rowEl = grid.createDiv({
				cls: `kisss3-diff-row is-${row.type}`,
			});
			rowEl.createDiv({ cls: "kisss3-diff-ln" }).setText(
				row.leftNo ? `${row.leftNo}` : "",
			);
			rowEl.createDiv({ cls: "kisss3-diff-text" }).setText(row.leftText);
			rowEl.createDiv({ cls: "kisss3-diff-ln" }).setText(
				row.rightNo ? `${row.rightNo}` : "",
			);
			rowEl.createDiv({ cls: "kisss3-diff-text" }).setText(row.rightText);
		}

		if (truncated) {
			panel.createEl("p", {
				cls: "kisss3-sync-preview-truncated",
				text: `Only first ${MAX_RENDER_DIFF_ROWS} diff rows are shown.`,
			});
		}
	}

	private buildDecisionGroups(actionable: FileSyncDecision[]): DecisionGroup[] {
		return [
			{
				action: SyncAction.UPLOAD,
				title: "Upload (local -> remote)",
				direction: "local -> remote",
				shortLabel: "U",
				items: actionable.filter((d) => d.action === SyncAction.UPLOAD),
			},
			{
				action: SyncAction.DOWNLOAD,
				title: "Download (remote -> local)",
				direction: "remote -> local",
				shortLabel: "D",
				items: actionable.filter((d) => d.action === SyncAction.DOWNLOAD),
			},
			{
				action: SyncAction.DELETE_LOCAL,
				title: "Delete local",
				direction: "remove local",
				shortLabel: "L",
				items: actionable.filter((d) => d.action === SyncAction.DELETE_LOCAL),
			},
			{
				action: SyncAction.DELETE_REMOTE,
				title: "Delete remote",
				direction: "remove remote",
				shortLabel: "R",
				items: actionable.filter((d) => d.action === SyncAction.DELETE_REMOTE),
			},
			{
				action: SyncAction.CONFLICT,
				title: "Conflicts",
				direction: "manual review",
				shortLabel: "C",
				items: actionable.filter((d) => d.action === SyncAction.CONFLICT),
			},
		];
	}

	private getActionTitle(action: SyncAction): string {
		switch (action) {
			case SyncAction.UPLOAD:
				return "Local -> Remote";
			case SyncAction.DOWNLOAD:
				return "Remote -> Local";
			case SyncAction.DELETE_LOCAL:
				return "Delete local";
			case SyncAction.DELETE_REMOTE:
				return "Delete remote";
			case SyncAction.CONFLICT:
				return "Conflict";
			default:
				return "No action";
		}
	}

	private async selectFile(decision: FileSyncDecision): Promise<void> {
		this.selectedDecision = decision;
		this.selectedFilePath = decision.filePath;
		this.contentError = null;

		const cached = this.contentCache.get(decision.filePath);
		if (cached) {
			this.selectedContent = cached;
			this.contentLoading = false;
			this.render();
			return;
		}

		this.selectedContent = null;
		this.contentLoading = true;
		this.render();

		try {
			const content = await this.options.loadFileContent(decision.filePath);
			this.contentCache.set(decision.filePath, content);
			if (this.selectedFilePath === decision.filePath) {
				this.selectedContent = content;
			}
		} catch (error) {
			if (this.selectedFilePath === decision.filePath) {
				this.contentError =
					error instanceof Error
						? `Failed to load file diff: ${error.message}`
						: "Failed to load file diff.";
			}
		} finally {
			if (this.selectedFilePath === decision.filePath) {
				this.contentLoading = false;
				this.render();
			}
		}
	}

	private buildDiffRows(
		localText: string | null,
		remoteText: string | null,
	): { rows: DiffRow[]; truncated: boolean } {
		const localLines = localText === null ? null : this.toLines(localText);
		const remoteLines = remoteText === null ? null : this.toLines(remoteText);

		let rows: DiffRow[] = [];

		if (localLines === null && remoteLines === null) {
			rows = [];
		} else if (localLines === null && remoteLines !== null) {
			rows = remoteLines.map((line, index) => ({
				type: "add",
				leftNo: null,
				leftText: "",
				rightNo: index + 1,
				rightText: line,
			}));
		} else if (localLines !== null && remoteLines === null) {
			rows = localLines.map((line, index) => ({
				type: "remove",
				leftNo: index + 1,
				leftText: line,
				rightNo: null,
				rightText: "",
			}));
		} else {
			rows = this.buildRowsFromTwoSides(localLines ?? [], remoteLines ?? []);
		}

		const truncated = rows.length > MAX_RENDER_DIFF_ROWS;
		return {
			rows: truncated ? rows.slice(0, MAX_RENDER_DIFF_ROWS) : rows,
			truncated,
		};
	}

	private toLines(text: string): string[] {
		if (text.length === 0) return [];
		return text.replace(/\r\n/g, "\n").split("\n");
	}

	private buildRowsFromTwoSides(
		localLines: string[],
		remoteLines: string[],
	): DiffRow[] {
		const n = localLines.length;
		const m = remoteLines.length;
		if (n * m > MAX_LCS_CELLS) {
			return this.buildRowsByIndex(localLines, remoteLines);
		}

		const ops = this.computeLcsOps(localLines, remoteLines);
		const rows: DiffRow[] = [];
		let leftNo = 1;
		let rightNo = 1;

		for (let i = 0; i < ops.length; i++) {
			const op = ops[i];
			const next = i + 1 < ops.length ? ops[i + 1] : null;

			if (op.type === "context") {
				rows.push({
					type: "context",
					leftNo,
					leftText: op.text,
					rightNo,
					rightText: op.text,
				});
				leftNo++;
				rightNo++;
				continue;
			}

			if (op.type === "remove" && next && next.type === "add") {
				rows.push({
					type: "modify",
					leftNo,
					leftText: op.text,
					rightNo,
					rightText: next.text,
				});
				leftNo++;
				rightNo++;
				i++;
				continue;
			}

			if (op.type === "add" && next && next.type === "remove") {
				rows.push({
					type: "modify",
					leftNo,
					leftText: next.text,
					rightNo,
					rightText: op.text,
				});
				leftNo++;
				rightNo++;
				i++;
				continue;
			}

			if (op.type === "remove") {
				rows.push({
					type: "remove",
					leftNo,
					leftText: op.text,
					rightNo: null,
					rightText: "",
				});
				leftNo++;
				continue;
			}

			rows.push({
				type: "add",
				leftNo: null,
				leftText: "",
				rightNo,
				rightText: op.text,
			});
			rightNo++;
		}

		return rows;
	}

	private buildRowsByIndex(localLines: string[], remoteLines: string[]): DiffRow[] {
		const rows: DiffRow[] = [];
		const max = Math.max(localLines.length, remoteLines.length);

		for (let i = 0; i < max; i++) {
			const left = i < localLines.length ? localLines[i] : null;
			const right = i < remoteLines.length ? remoteLines[i] : null;

			if (left !== null && right !== null && left === right) {
				rows.push({
					type: "context",
					leftNo: i + 1,
					leftText: left,
					rightNo: i + 1,
					rightText: right,
				});
				continue;
			}

			if (left !== null && right !== null) {
				rows.push({
					type: "modify",
					leftNo: i + 1,
					leftText: left,
					rightNo: i + 1,
					rightText: right,
				});
				continue;
			}

			if (left !== null) {
				rows.push({
					type: "remove",
					leftNo: i + 1,
					leftText: left,
					rightNo: null,
					rightText: "",
				});
				continue;
			}

			rows.push({
				type: "add",
				leftNo: null,
				leftText: "",
				rightNo: i + 1,
				rightText: right ?? "",
			});
		}

		return rows;
	}

	private computeLcsOps(localLines: string[], remoteLines: string[]): DiffOp[] {
		const n = localLines.length;
		const m = remoteLines.length;
		const dp: number[][] = Array.from({ length: n + 1 }, () =>
			new Array<number>(m + 1).fill(0),
		);

		for (let i = 1; i <= n; i++) {
			for (let j = 1; j <= m; j++) {
				if (localLines[i - 1] === remoteLines[j - 1]) {
					dp[i][j] = dp[i - 1][j - 1] + 1;
				} else {
					dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
				}
			}
		}

		const ops: DiffOp[] = [];
		let i = n;
		let j = m;
		while (i > 0 && j > 0) {
			if (localLines[i - 1] === remoteLines[j - 1]) {
				ops.push({ type: "context", text: localLines[i - 1] });
				i--;
				j--;
				continue;
			}

			if (dp[i - 1][j] >= dp[i][j - 1]) {
				ops.push({ type: "remove", text: localLines[i - 1] });
				i--;
				continue;
			}

			ops.push({ type: "add", text: remoteLines[j - 1] });
			j--;
		}

		while (i > 0) {
			ops.push({ type: "remove", text: localLines[i - 1] });
			i--;
		}
		while (j > 0) {
			ops.push({ type: "add", text: remoteLines[j - 1] });
			j--;
		}

		ops.reverse();
		return ops;
	}

	private async refreshPreview(): Promise<void> {
		this.loading = true;
		this.loadError = null;
		this.render();
		try {
			this.decisions = await this.options.loadPreview();
			const actionableFileSet = new Set(
				this.decisions
					.filter((d) => d.action !== SyncAction.DO_NOTHING)
					.map((d) => d.filePath),
			);
			if (this.selectedFilePath && !actionableFileSet.has(this.selectedFilePath)) {
				this.selectedFilePath = null;
				this.selectedDecision = null;
				this.selectedContent = null;
				this.contentError = null;
				this.contentLoading = false;
			}
		} catch (error) {
			this.loadError =
				error instanceof Error
					? `Failed to load preview: ${error.message}`
					: "Failed to load preview.";
		} finally {
			this.loading = false;
			this.render();
		}
	}

	private async syncAndRefresh(): Promise<void> {
		this.syncing = true;
		this.render();
		try {
			await this.options.runSync();
			new Notice("S3 Sync: Sync completed.");
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Sync failed unexpectedly.";
			new Notice(`S3 Sync: ${message}`);
		} finally {
			this.syncing = false;
			await this.refreshPreview();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
