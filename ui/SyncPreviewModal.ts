import { App, ButtonComponent, Modal, Notice } from "obsidian";
import {
	FileSyncDecision,
	SyncAction,
	SyncPreviewFileContent,
} from "../sync/SyncTypes";

const MAX_ITEMS_INITIAL = 80;
const ITEMS_PAGE_SIZE = 80;
const MAX_LCS_CELLS = 2_000_000;
const MAX_DIFF_ROWS = 20_000;
const DIFF_ROW_HEIGHT = 22;
const DIFF_VIEWPORT_ROWS = 120;
const DIFF_OVERSCAN = 40;

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

type DiffStats = {
	added: number;
	removed: number;
	modified: number;
};

type DiffResult = {
	rows: DiffRow[];
	stats: DiffStats;
	truncated: boolean;
};

type DiffCacheEntry = {
	localText: string | null;
	remoteText: string | null;
	result: DiffResult;
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
	private diffCache = new Map<string, DiffCacheEntry>();
	private selectedContent: SyncPreviewFileContent | null = null;
	private groupVisibleCount = new Map<SyncAction, number>();

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
		this.ensureGroupVisibleCounts(groups);

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
			sectionSummary.createEl("span", { text: `${group.title}` });
			sectionSummary.createEl("span", {
				cls: "kisss3-sync-preview-group-direction",
				text: group.direction,
			});
			sectionSummary.createEl("span", {
				cls: "kisss3-sync-preview-group-count",
				text: `${group.items.length}`,
			});

			const visibleCount = this.groupVisibleCount.get(group.action) ?? MAX_ITEMS_INITIAL;
			const visibleItems = group.items.slice(0, visibleCount);

			const ul = sectionEl.createEl("ul", { cls: "kisss3-sync-preview-list" });
			for (const item of visibleItems) {
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

			if (visibleCount < group.items.length) {
				const remaining = group.items.length - visibleCount;
				const moreEl = sectionEl.createDiv({ cls: "kisss3-sync-preview-more" });
				new ButtonComponent(moreEl)
					.setButtonText(`Show more (${remaining})`)
					.onClick(() => {
						this.groupVisibleCount.set(
							group.action,
							Math.min(group.items.length, visibleCount + ITEMS_PAGE_SIZE),
						);
						this.render();
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
			meta.setText(this.selectedDecision.filePath);

			const direction = panel.createDiv({ cls: "kisss3-diff-direction" });
			direction.createEl("span", {
				cls: "kisss3-diff-direction-label",
				text: this.getActionTitle(this.selectedDecision.action),
			});
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

		if (!this.selectedContent || !this.selectedFilePath) {
			panel.createEl("p", {
				cls: "kisss3-diff-empty",
				text: "No diff content available.",
			});
			return;
		}

		const diffResult = this.getDiffResult(
			this.selectedFilePath,
			this.selectedContent.localText,
			this.selectedContent.remoteText,
		);
		if (diffResult.rows.length === 0) {
			panel.createEl("p", {
				cls: "kisss3-diff-empty",
				text: "No line differences detected.",
			});
			return;
		}

		const statBar = panel.createDiv({ cls: "kisss3-diff-stats" });
		statBar.createEl("span", {
			cls: "kisss3-diff-stat is-add",
			text: `+${diffResult.stats.added}`,
		});
		statBar.createEl("span", {
			cls: "kisss3-diff-stat is-remove",
			text: `-${diffResult.stats.removed}`,
		});
		statBar.createEl("span", {
			cls: "kisss3-diff-stat is-modify",
			text: `~${diffResult.stats.modified}`,
		});

		const split = panel.createDiv({ cls: "kisss3-diff-split" });
		const leftPane = split.createDiv({ cls: "kisss3-diff-pane" });
		const rightPane = split.createDiv({ cls: "kisss3-diff-pane" });

		leftPane.createDiv({ cls: "kisss3-diff-pane-title", text: "Local" });
		rightPane.createDiv({ cls: "kisss3-diff-pane-title", text: "Remote" });

		const leftScroll = leftPane.createDiv({ cls: "kisss3-diff-pane-scroll" });
		const rightScroll = rightPane.createDiv({ cls: "kisss3-diff-pane-scroll" });

		const leftSpacer = leftScroll.createDiv({ cls: "kisss3-diff-pane-spacer" });
		const rightSpacer = rightScroll.createDiv({ cls: "kisss3-diff-pane-spacer" });
		const leftRowsLayer = leftScroll.createDiv({ cls: "kisss3-diff-pane-rows" });
		const rightRowsLayer = rightScroll.createDiv({ cls: "kisss3-diff-pane-rows" });

		const totalRows = diffResult.rows.length;
		const spacerHeight = totalRows * DIFF_ROW_HEIGHT;
		leftSpacer.style.height = `${spacerHeight}px`;
		rightSpacer.style.height = `${spacerHeight}px`;

		const renderWindow = (scrollTop: number) => {
			const start = Math.max(
				0,
				Math.floor(scrollTop / DIFF_ROW_HEIGHT) - DIFF_OVERSCAN,
			);
			const end = Math.min(
				totalRows,
				start + DIFF_VIEWPORT_ROWS + DIFF_OVERSCAN * 2,
			);
			const offsetTop = start * DIFF_ROW_HEIGHT;

			leftRowsLayer.empty();
			rightRowsLayer.empty();
			leftRowsLayer.style.transform = `translateY(${offsetTop}px)`;
			rightRowsLayer.style.transform = `translateY(${offsetTop}px)`;

			for (let i = start; i < end; i++) {
				const row = diffResult.rows[i];
				leftRowsLayer.appendChild(this.createPaneRow(true, row));
				rightRowsLayer.appendChild(this.createPaneRow(false, row));
			}
		};

		let syncingScroll = false;
		const syncFromLeft = () => {
			if (syncingScroll) return;
			syncingScroll = true;
			rightScroll.scrollTop = leftScroll.scrollTop;
			syncingScroll = false;
			renderWindow(leftScroll.scrollTop);
		};
		const syncFromRight = () => {
			if (syncingScroll) return;
			syncingScroll = true;
			leftScroll.scrollTop = rightScroll.scrollTop;
			syncingScroll = false;
			renderWindow(rightScroll.scrollTop);
		};

		leftScroll.addEventListener("scroll", syncFromLeft);
		rightScroll.addEventListener("scroll", syncFromRight);
		renderWindow(0);

		if (diffResult.truncated) {
			panel.createEl("p", {
				cls: "kisss3-sync-preview-truncated",
				text: `Diff exceeds ${MAX_DIFF_ROWS} rows. Showing a truncated result for performance.`,
			});
		}
	}

	private createPaneRow(isLeft: boolean, row: DiffRow): HTMLDivElement {
		const rowEl = createDiv({
			cls: `kisss3-diff-pane-row is-${row.type}`,
		});
		const lineNo = isLeft ? row.leftNo : row.rightNo;
		const text = isLeft ? row.leftText : row.rightText;

		rowEl.style.height = `${DIFF_ROW_HEIGHT}px`;
		rowEl.createDiv({ cls: "kisss3-diff-ln", text: lineNo ? `${lineNo}` : "" });
		rowEl.createDiv({ cls: "kisss3-diff-text", text });
		return rowEl;
	}

	private ensureGroupVisibleCounts(groups: DecisionGroup[]): void {
		for (const group of groups) {
			const current = this.groupVisibleCount.get(group.action);
			if (current === undefined) {
				this.groupVisibleCount.set(group.action, MAX_ITEMS_INITIAL);
			}

			if (
				this.selectedFilePath &&
				group.items.some((item) => item.filePath === this.selectedFilePath)
			) {
				const index = group.items.findIndex(
					(item) => item.filePath === this.selectedFilePath,
				);
				const needed = index + 1;
				const visible = this.groupVisibleCount.get(group.action) ?? MAX_ITEMS_INITIAL;
				if (needed > visible) {
					this.groupVisibleCount.set(group.action, needed);
				}
			}
		}
	}

	private getDiffResult(
		filePath: string,
		localText: string | null,
		remoteText: string | null,
	): DiffResult {
		const cached = this.diffCache.get(filePath);
		if (
			cached &&
			cached.localText === localText &&
			cached.remoteText === remoteText
		) {
			return cached.result;
		}

		const result = this.buildDiffRows(localText, remoteText);
		this.diffCache.set(filePath, {
			localText,
			remoteText,
			result,
		});
		return result;
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
	): DiffResult {
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

		let truncated = false;
		if (rows.length > MAX_DIFF_ROWS) {
			rows = rows.slice(0, MAX_DIFF_ROWS);
			truncated = true;
		}

		return {
			rows,
			stats: this.computeDiffStats(rows),
			truncated,
		};
	}

	private computeDiffStats(rows: DiffRow[]): DiffStats {
		const stats: DiffStats = { added: 0, removed: 0, modified: 0 };
		for (const row of rows) {
			if (row.type === "add") stats.added++;
			else if (row.type === "remove") stats.removed++;
			else if (row.type === "modify") stats.modified++;
		}
		return stats;
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
