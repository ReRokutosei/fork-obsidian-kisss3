// Import necessary modules from Obsidian
import { Notice, Plugin, TFile } from "obsidian";

// Import local modules
import {
	S3SyncSettings,
	DEFAULT_SETTINGS,
	normalizeRemotePrefix,
} from "./settings";
import { SyncManager } from "./sync/SyncManager";
import { S3SyncSettingTab } from "./ui/S3SyncSettingTab";
import { SyncPreviewModal } from "./ui/SyncPreviewModal";
import { BUILD_MARKER, BUILD_NUMBER, BUILD_TIMESTAMP } from "./build-meta";

export default class S3SyncPlugin extends Plugin {
	settings: S3SyncSettings;
	private syncManager: SyncManager;
	private syncIntervalId: number | null = null;
	private syncRibbonEl: HTMLElement | null = null;
	private syncInProgress = false;

	async onload() {
		console.info(
			`[kisss3] onload build=${BUILD_MARKER} (#${BUILD_NUMBER}) timestamp=${BUILD_TIMESTAMP} version=${this.manifest.version}`,
		);

		await this.loadSettings();
		this.syncManager = new SyncManager(this.app, this);

		this.addSettingTab(new S3SyncSettingTab(this.app, this));

		this.addCommand({
			id: "s3-sync-now",
			name: "Sync now",
			callback: async () => {
				await this.runSyncNow();
			},
		});

		this.addCommand({
			id: "s3-sync-preview",
			name: "Preview sync status",
			callback: async () => {
				this.openSyncPreview();
			},
		});

		this.addRibbonIcon("list", "S3 Sync: Preview", () => {
			this.openSyncPreview();
		});

		this.syncRibbonEl = this.addRibbonIcon("refresh-cw", "S3 Sync: Sync now", () => {
			this.runSyncNow();
		});
		this.updateSyncRibbonState();

		// Register delete event handler for real-time sync
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (
					file instanceof TFile &&
					!file.path.split("/").some((part) => part.startsWith("."))
				) {
					this.syncManager.handleLocalDelete(file.path);
				}
			}),
		);

		this.updateSyncInterval();
		this.syncManager; // Run initial sync automatically when plugin loads
	}

	private openSyncPreview() {
		new SyncPreviewModal(this.app, {
			loadPreview: () => this.syncManager.getSyncPreview(),
			runSync: () => this.runSyncNow(),
		}).open();
	}

	private async runSyncNow(): Promise<void> {
		if (this.syncInProgress) {
			new Notice("S3 Sync: A sync is already in progress.");
			return;
		}

		this.syncInProgress = true;
		this.updateSyncRibbonState();
		try {
			await this.syncManager.runSync();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Unable to run sync right now.";
			new Notice(`S3 Sync: ${message}`);
		} finally {
			this.syncInProgress = false;
			this.updateSyncRibbonState();
		}
	}

	private updateSyncRibbonState() {
		if (!this.syncRibbonEl) return;
		this.syncRibbonEl.toggleClass("mod-spin", this.syncInProgress);
		this.syncRibbonEl.toggleClass("is-disabled", this.syncInProgress);
		this.syncRibbonEl.ariaDisabled = this.syncInProgress ? "true" : "false";
	}

	onunload() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
		this.settings.remotePrefix = normalizeRemotePrefix(
			this.settings.remotePrefix ?? "",
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Inform the sync manager and scheduler of setting changes.
		this.syncManager.updateSettings(this.settings);
		this.updateSyncInterval();
	}

	updateSyncInterval() {
		// Clear any existing interval to prevent duplicates.
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}

		if (
			this.settings.enableAutomaticSync &&
			this.settings.syncIntervalMinutes > 0
		) {
			const intervalMillis =
				this.settings.syncIntervalMinutes * 60 * 1000;
			this.syncIntervalId = window.setInterval(() => {
				this.syncManager.runSync();
			}, intervalMillis);

			if (this.settings.enableDebugLogging) {
				console.log(`Sync interval: ${intervalMillis}ms`);
			}

			// Register the interval so Obsidian can manage it.
			this.registerInterval(this.syncIntervalId);
		}
	}
}
