import { App, Modal } from "obsidian";
import { FileSyncDecision, SyncAction } from "../sync/SyncTypes";

const MAX_ITEMS_PER_SECTION = 120;

type DecisionGroup = {
	title: string;
	items: FileSyncDecision[];
};

export class SyncPreviewModal extends Modal {
	constructor(app: App, private decisions: FileSyncDecision[]) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "S3 sync status" });

		const actionable = this.decisions.filter(
			(d) => d.action !== SyncAction.DO_NOTHING,
		);

		if (actionable.length === 0) {
			contentEl.createEl("p", {
				text: "No changes detected. Local and remote are in sync.",
			});
			return;
		}

		const groups: DecisionGroup[] = [
			{
				title: "Upload (local → remote)",
				items: actionable.filter((d) => d.action === SyncAction.UPLOAD),
			},
			{
				title: "Download (remote → local)",
				items: actionable.filter((d) => d.action === SyncAction.DOWNLOAD),
			},
			{
				title: "Delete local",
				items: actionable.filter((d) => d.action === SyncAction.DELETE_LOCAL),
			},
			{
				title: "Delete remote",
				items: actionable.filter((d) => d.action === SyncAction.DELETE_REMOTE),
			},
			{
				title: "Conflicts",
				items: actionable.filter((d) => d.action === SyncAction.CONFLICT),
			},
		];

		for (const group of groups) {
			if (group.items.length === 0) continue;

			contentEl.createEl("h3", {
				text: `${group.title} (${group.items.length})`,
			});
			const ul = contentEl.createEl("ul");
			for (const item of group.items.slice(0, MAX_ITEMS_PER_SECTION)) {
				ul.createEl("li", { text: item.filePath });
			}

			if (group.items.length > MAX_ITEMS_PER_SECTION) {
				contentEl.createEl("p", {
					text: `...and ${group.items.length - MAX_ITEMS_PER_SECTION} more`,
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
