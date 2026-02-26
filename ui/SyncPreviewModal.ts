import { App, Modal } from "obsidian";
import { FileSyncDecision, SyncAction } from "../sync/SyncTypes";

const MAX_ITEMS_PER_SECTION = 120;

type DecisionGroup = {
	action: SyncAction;
	title: string;
	shortLabel: string;
	items: FileSyncDecision[];
};

export class SyncPreviewModal extends Modal {
	constructor(app: App, private decisions: FileSyncDecision[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("kisss3-sync-preview");

		contentEl.createEl("h2", { text: "Sync preview" });

		const actionable = this.decisions.filter(
			(d) => d.action !== SyncAction.DO_NOTHING,
		);

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
				shortLabel: "U",
				items: actionable.filter((d) => d.action === SyncAction.UPLOAD),
			},
			{
				action: SyncAction.DOWNLOAD,
				title: "Download (remote → local)",
				shortLabel: "D",
				items: actionable.filter((d) => d.action === SyncAction.DOWNLOAD),
			},
			{
				action: SyncAction.DELETE_LOCAL,
				title: "Delete local",
				shortLabel: "L",
				items: actionable.filter((d) => d.action === SyncAction.DELETE_LOCAL),
			},
			{
				action: SyncAction.DELETE_REMOTE,
				title: "Delete remote",
				shortLabel: "R",
				items: actionable.filter((d) => d.action === SyncAction.DELETE_REMOTE),
			},
			{
				action: SyncAction.CONFLICT,
				title: "Conflicts",
				shortLabel: "C",
				items: actionable.filter((d) => d.action === SyncAction.CONFLICT),
			},
		];

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

	onClose(): void {
		this.contentEl.empty();
	}
}
