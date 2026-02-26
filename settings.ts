// --- Plugin Settings Interface ---
export interface S3SyncSettings {
	endpoint: string;
	region: string;
	bucketName: string;
	accessKeyId: string;
	secretAccessKey: string;
	remotePrefix: string;
	syncIntervalMinutes: number;
	enableAutomaticSync: boolean;
	enableDebugLogging: boolean;
	ignorePatterns: string;
	// lastSyncTimestamp removed - now using sync-state.json file
}

export function normalizeRemotePrefix(prefix: string): string {
	const trimmed = prefix.trim();
	if (!trimmed || trimmed === "/") {
		return "";
	}
	return trimmed.replace(/^\/+|\/+$/g, "");
}

// --- Default Settings ---
export const DEFAULT_SETTINGS: S3SyncSettings = {
	endpoint: "",
	region: "",
	bucketName: "",
	accessKeyId: "",
	secretAccessKey: "",
	remotePrefix: "",
	syncIntervalMinutes: 15,
	enableAutomaticSync: false,
	enableDebugLogging: false,
	ignorePatterns: "",
};
