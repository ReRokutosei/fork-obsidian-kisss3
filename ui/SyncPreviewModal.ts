import { App, ButtonComponent, Modal, Notice } from "obsidian";
import { FileSyncDecision, SyncAction } from "../sync/SyncTypes";

const MAX_ITEMS_PER_SECTION = 120;

type SyncPreviewModalOptions = {
	loadPreview: () => Promise<FileSyncDecision[]>;
	runSync: () => Promise<void>;
};

type DecisionGroup = {
	action: SyncAction;
	title: string;
	direction: string;
	shortLabel: string;
	items: FileSyncDecision[];
};

export class SyncPreviewModal extends Modal {
	private decisions: FileSyncDecision[] = [];
	private loading = false;
	private syncing = false;
	private loadError: string | null = null;

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

		const groups: DecisionGroup[] = [
			{
				action: SyncAction.UPLOAD,
				title: "Upload (local → remote)",
				direction: "local → remote",
				shortLabel: "U",
				items: actionable.filter((d) => d.action === SyncAction.UPLOAD),
			},
			{
				action: SyncAction.DOWNLOAD,
				title: "Download (remote → local)",
				direction: "remote → local",
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
				li.createEl("code", { text: item.filePath });
			}

			if (group.items.length > MAX_ITEMS_PER_SECTION) {
				sectionEl.createEl("p", {
					cls: "kisss3-sync-preview-truncated",
					text: `...and ${group.items.length - MAX_ITEMS_PER_SECTION} more`,
				});
			}
		}
	}

	private async refreshPreview(): Promise<void> {
		this.loading = true;
		this.loadError = null;
		this.render();
		try {
			this.decisions = await this.options.loadPreview();
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
