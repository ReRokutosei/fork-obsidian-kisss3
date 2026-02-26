import { App, PluginSettingTab, Setting } from "obsidian";
import S3SyncPlugin from "../main";
import { normalizeRemotePrefix } from "../settings";

export class S3SyncSettingTab extends PluginSettingTab {
	plugin: S3SyncPlugin;

	constructor(app: App, plugin: S3SyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "S3 sync settings" });
		containerEl.createEl("p", {
			text: "Configure connection, sync behavior, and ignore rules.",
		});

		new Setting(containerEl).setHeading().setName("Connection");

		new Setting(containerEl)
			.setName("S3 Endpoint")
			.setDesc("S3-compatible endpoint, for example Cloudflare R2 endpoint.")
			.addText((text) =>
				text
					.setPlaceholder("https://s3.amazonaws.com")
					.setValue(this.plugin.settings.endpoint)
					.onChange(async (value) => {
						this.plugin.settings.endpoint = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("S3 Region")
			.setDesc('Bucket region. For Cloudflare R2, use "auto".')
			.addText((text) =>
				text
					.setPlaceholder("us-east-1")
					.setValue(this.plugin.settings.region)
					.onChange(async (value) => {
						this.plugin.settings.region = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Bucket Name")
			.setDesc("Target bucket name.")
			.addText((text) =>
				text
					.setPlaceholder("my-obsidian-vault")
					.setValue(this.plugin.settings.bucketName)
					.onChange(async (value) => {
						this.plugin.settings.bucketName = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Access Key ID")
			.setDesc("Access key ID for the bucket credentials.")
			.addText((text) =>
				text
					.setPlaceholder("AKIA...")
					.setValue(this.plugin.settings.accessKeyId)
					.onChange(async (value) => {
						this.plugin.settings.accessKeyId = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Secret Access Key")
			.setDesc("Secret key for the bucket credentials.")
			.addText((text) =>
				text
					.setPlaceholder("Your secret key")
					.setValue(this.plugin.settings.secretAccessKey)
					.onChange(async (value) => {
						this.plugin.settings.secretAccessKey = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Remote prefix (folder)")
			.setDesc(
				"Optional subfolder in bucket. Leave empty to sync at bucket root.",
			)
			.addText((text) =>
				text
					.setPlaceholder("my-vault")
					.setValue(this.plugin.settings.remotePrefix)
					.onChange(async (value) => {
						this.plugin.settings.remotePrefix = normalizeRemotePrefix(value);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setHeading().setName("Ignore rules");

		new Setting(containerEl)
			.setName("Ignore patterns")
			.setDesc(
				"Gitignore-like patterns, one per line. Example: _remotely-save-metadata-on-remote.json or .obsidian/**",
			)
			.addTextArea((text) => {
				text
					.setPlaceholder(
						"# One pattern per line\n_remotely-save-metadata-on-remote.json\n.obsidian/**",
					)
					.setValue(this.plugin.settings.ignorePatterns)
					.onChange(async (value) => {
						this.plugin.settings.ignorePatterns = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 6;
				text.inputEl.cols = 40;
			});

		new Setting(containerEl).setHeading().setName("Automatic sync");

		new Setting(containerEl)
			.setName("Enable automatic sync")
			.setDesc("Enable syncing at a regular interval.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableAutomaticSync)
					.onChange(async (value) => {
						this.plugin.settings.enableAutomaticSync = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sync interval (minutes)")
			.setDesc(
				"How often to sync automatically. Must be a number greater than 0.",
			)
			.addText((text) =>
				text
					.setPlaceholder("15")
					.setValue(
						this.plugin.settings.syncIntervalMinutes.toString(),
					)
					.onChange(async (value) => {
						const numValue = parseInt(value, 10);
						if (!isNaN(numValue) && numValue > 0) {
							this.plugin.settings.syncIntervalMinutes = numValue;
							await this.plugin.saveSettings();
						}
					}),
			);
		new Setting(containerEl).setHeading().setName("Debug");

		new Setting(containerEl)
			.setName("Enable debug logging")
			.setDesc("Enable logging to Obsidian's log file.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableDebugLogging)
					.onChange(async (value) => {
						this.plugin.settings.enableDebugLogging = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
