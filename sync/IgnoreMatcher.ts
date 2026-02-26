import ignore, { Ignore } from "ignore";

export class IgnoreMatcher {
	private ig: Ignore;

	constructor(patternsText = "") {
		this.ig = ignore();

		const lines = patternsText
			.split(/\r?\n/)
			.map((line) => line.replace(/\r/g, ""));

		const patterns = lines.filter((line) => {
			const trimmed = line.trim();
			return trimmed.length > 0 && !trimmed.startsWith("#");
		});

		if (patterns.length > 0) {
			this.ig.add(patterns);
		}
	}

	ignores(path: string): boolean {
		return this.ig.ignores(path);
	}
}
