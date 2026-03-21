/**
 * Impeccable pi extension
 *
 * Provides one slash command: /impeccable
 * - Command picker sourced from ./commands/*.md (next to this file)
 * - Argument-aware prompting and inline key=value support
 * - Sends the expanded command body as a user message
 *
 * Setup:
 * 1) Place this extension at:
 *    ~/.pi/agent/extensions/impeccable/index.ts
 *    (or project-local: .pi/extensions/impeccable/index.ts)
 * 2) Ensure command files exist at ./commands/*.md relative to index.ts
 *
 * Pull commands + local frontend-design skill from GitHub via sparse checkout:
 *   git clone --depth=1 --filter=blob:none --sparse https://github.com/pbakaus/impeccable.git /tmp/impeccable && \
 *   git -C /tmp/impeccable sparse-checkout set source/commands source/skills/frontend-design && \
 *   mkdir -p ~/.pi/agent/extensions/impeccable/commands ~/.pi/agent/extensions/impeccable/skills && \
 *   cp -R /tmp/impeccable/source/commands/*.md ~/.pi/agent/extensions/impeccable/commands/ && \
 *   rm -rf ~/.pi/agent/extensions/impeccable/skills/frontend-design && \
 *   cp -R /tmp/impeccable/source/skills/frontend-design ~/.pi/agent/extensions/impeccable/skills/frontend-design && \
 *   rm -rf /tmp/impeccable
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
	Container,
	fuzzyFilter,
	Input,
	Key,
	getKeybindings,
	matchesKey,
	Spacer,
	type SelectItem,
	SelectList,
	Text,
} from "@mariozechner/pi-tui";

type CommandArg = {
	name: string;
	description?: string;
	required?: boolean;
};

type SourceCommand = {
	name: string;
	description: string;
	args: CommandArg[];
	body: string;
	pickerLabel?: string;
};

const FRONTEND_DESIGN_PICKER_COMMAND_NAME = "frontend-design";

function getFrontendDesignPickerCommand(): SourceCommand {
	return {
		name: FRONTEND_DESIGN_PICKER_COMMAND_NAME,
		pickerLabel: "skill: frontend-design",
		description: "Load vendored frontend-design skill (extension-local)",
		args: [],
		body: "",
	};
}

const PI_BASE_PLACEHOLDERS: Record<string, string> = {
	model: "the model",
	config_file: "AGENTS.md",
	ask_instruction: "ask the user directly to clarify what you cannot infer.",
};

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!frontmatterMatch) {
		return { frontmatter: {}, body: content.trim() };
	}

	const [, frontmatterText, body] = frontmatterMatch;
	const lines = frontmatterText.split("\n");
	const frontmatter: Record<string, unknown> = {};
	let currentArray: Array<Record<string, unknown>> | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const indent = line.length - line.trimStart().length;

		if (indent === 0) {
			const colonIndex = trimmed.indexOf(":");
			if (colonIndex < 1) continue;

			const key = trimmed.slice(0, colonIndex).trim();
			const value = trimmed.slice(colonIndex + 1).trim();

			if (value) {
				frontmatter[key] = parseScalar(value);
				currentArray = null;
			} else {
				const arr: Array<Record<string, unknown>> = [];
				frontmatter[key] = arr;
				currentArray = arr;
			}
			continue;
		}

		if (trimmed.startsWith("- ") && indent >= 2 && currentArray) {
			const itemText = trimmed.slice(2).trim();
			if (!itemText) {
				currentArray.push({});
				continue;
			}

			const colonIndex = itemText.indexOf(":");
			if (colonIndex > 0) {
				const key = itemText.slice(0, colonIndex).trim();
				const value = itemText.slice(colonIndex + 1).trim();
				currentArray.push({ [key]: parseScalar(value) });
			}
			continue;
		}

		if (indent >= 4 && currentArray && currentArray.length > 0) {
			const colonIndex = trimmed.indexOf(":");
			if (colonIndex > 0) {
				const key = trimmed.slice(0, colonIndex).trim();
				const value = trimmed.slice(colonIndex + 1).trim();
				currentArray[currentArray.length - 1]![key] = parseScalar(value);
			}
		}
	}

	return { frontmatter, body: body.trim() };
}

function parseScalar(value: string): string | boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	return value.replace(/^['"]|['"]$/g, "");
}

function resolveExtensionDir(): string {
	return path.dirname(fileURLToPath(import.meta.url));
}

function resolveCommandsDir(): string | null {
	const commandsDir = path.join(resolveExtensionDir(), "commands");
	if (!fs.existsSync(commandsDir)) return null;
	return commandsDir;
}

function getPiPlaceholders(): Record<string, string> {
	const extensionDir = resolveExtensionDir();
	const normalize = (p: string) => p.replaceAll("\\", "/");
	const frontendDesignSkillPath = normalize(path.join(extensionDir, "skills", "frontend-design", "SKILL.md"));
	const frontendDesignReferenceGlob = normalize(path.join(extensionDir, "skills", "frontend-design", "reference", "*.md"));

	return {
		...PI_BASE_PLACEHOLDERS,
		frontend_design_skill_path: frontendDesignSkillPath,
		frontend_design_reference_glob: frontendDesignReferenceGlob,
	};
}

function buildFrontendDesignSkillBlock(): string | null {
	const placeholders = getPiPlaceholders();
	const skillPath = placeholders.frontend_design_skill_path;
	if (!skillPath || !fs.existsSync(skillPath)) return null;

	const content = fs.readFileSync(skillPath, "utf8");
	const { body } = parseFrontmatter(content);
	const skillBody = body.trim();
	if (!skillBody) return null;

	const baseDir = path.dirname(skillPath).replaceAll("\\", "/");
	return `<skill name="${FRONTEND_DESIGN_PICKER_COMMAND_NAME}" location="${skillPath}">\nReferences are relative to ${baseDir}.\n\n${skillBody}\n</skill>`;
}

function readSourceCommands(): SourceCommand[] {
	const commandsDir = resolveCommandsDir();
	if (!commandsDir) return [];

	const files = fs
		.readdirSync(commandsDir)
		.filter((file) => file.endsWith(".md"))
		.sort((a, b) => a.localeCompare(b));

	return files.map((file) => {
		const content = fs.readFileSync(path.join(commandsDir, file), "utf8");
		const { frontmatter, body } = parseFrontmatter(content);
		const rawArgs = Array.isArray(frontmatter.args) ? frontmatter.args : [];

		const args: CommandArg[] = rawArgs.map((item) => ({
			name: String(item.name ?? "").trim(),
			description: item.description ? String(item.description) : undefined,
			required: Boolean(item.required),
		}));

		return {
			name: String(frontmatter.name || path.basename(file, ".md")),
			description: String(frontmatter.description || ""),
			args: args.filter((arg) => arg.name.length > 0),
			body,
		};
	});
}

function applyPlaceholders(template: string, values: Record<string, string>): string {
	let output = template;
	for (const [key, value] of Object.entries(values)) {
		output = output.replaceAll(`{{${key}}}`, value);
	}
	return output;
}

function parseInlineNamedArgs(raw: string): Record<string, string> {
	const result: Record<string, string> = {};
	const matches = raw.matchAll(/([a-zA-Z0-9_-]+)=((?:"[^"]*")|(?:'[^']*')|(?:\S+))/g);
	for (const match of matches) {
		const [, key, rawValue] = match;
		if (!key || !rawValue) continue;
		result[key] = rawValue.replace(/^['"]|['"]$/g, "");
	}
	return result;
}

async function pickCommand(commands: SourceCommand[], ctx: ExtensionCommandContext): Promise<SourceCommand | null> {
	const items: SelectItem[] = commands.map((command) => ({
		value: command.name,
		label: command.pickerLabel ?? command.name,
	}));
	const commandByName = new Map(commands.map((command) => [command.name, command]));

	const selectedName = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		const kb = getKeybindings();
		const filterInput = new Input();
		let focused = false;
		let hasMatches = true;
		let list: SelectList;
		let preview: Text;

		const updatePreview = (name?: string) => {
			if (!name) {
				preview.setText("");
				return;
			}

			const command = commandByName.get(name);
			const description = command?.description || "No description";
			preview.setText(theme.fg("muted", description));
		};

		const buildList = () => {
			const query = filterInput.getValue().trim();
			const filteredItems = query ? fuzzyFilter(items, query, (item) => item.label) : items;
			hasMatches = filteredItems.length > 0;

			list = new SelectList(filteredItems, Math.min(Math.max(filteredItems.length, 1), 12), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			preview = new Text("", 1, 0);
			updatePreview(filteredItems[0]?.value);

			list.onSelectionChange = (item) => updatePreview(item.value);
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(null);
		};

		const rebuild = () => {
			container.clear();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(filterInput);
			container.addChild(new Spacer(1));
			buildList();
			container.addChild(list);
			if (hasMatches) {
				container.addChild(preview);
			}
			container.addChild(new Text(theme.fg("dim", "Type to search · Enter to select · Esc to cancel"), 1, 0));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			filterInput.focused = focused;
		};

		rebuild();

		return {
			get focused() {
				return focused;
			},
			set focused(value: boolean) {
				focused = value;
				filterInput.focused = value;
			},
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
				rebuild();
			},
			handleInput(data: string) {
				if (
					kb.matches(data, "tui.select.up") ||
					kb.matches(data, "tui.select.down") ||
					kb.matches(data, "tui.select.confirm") ||
					kb.matches(data, "tui.select.cancel")
				) {
					list.handleInput(data);
					tui.requestRender();
					return;
				}

				const sanitized = data.replace(/ /g, "");
				if (!sanitized) return;

				filterInput.handleInput(sanitized);
				rebuild();
				tui.requestRender();
			},
		};
	});

	if (!selectedName) return null;
	return commands.find((command) => command.name === selectedName) ?? null;
}

async function collectArgs(
	command: SourceCommand,
	ctx: ExtensionCommandContext,
	seedValues: Record<string, string>,
): Promise<{ args: Record<string, string> } | { cancelled: true }> {
	if (command.args.length === 0) {
		return { args: {} };
	}

	const inputs = command.args.map((arg) => {
		const input = new Input();
		input.setValue(seedValues[arg.name] ?? "");
		return input;
	});

	const result = await ctx.ui.custom<{ values: string[] } | undefined>((tui, theme, _kb, done) => {
		const container = new Container();
		const kb = getKeybindings();
		let focused = false;
		let activeIndex = 0;
		let errorMessage = "";

		const updateInputFocus = () => {
			for (const [index, input] of inputs.entries()) {
				input.focused = focused && index === activeIndex;
			}
		};

		const rebuild = () => {
			container.clear();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("accent", command.description || `/${command.name}`), 1, 0));
			container.addChild(new Spacer(1));

			for (const [index, arg] of command.args.entries()) {
				const isActive = index === activeIndex;
				container.addChild(new Text(theme.fg("accent", arg.name), 1, 0));
				container.addChild(
					new Text(theme.fg("dim", arg.description || (arg.required ? "Required" : "Optional")), 1, 0),
				);

				if (isActive) {
					container.addChild(inputs[index]!);
				} else {
					const preview = inputs[index]!.getValue().trim();
					if (preview) {
						container.addChild(new Text(theme.fg("text", preview), 1, 0));
					}
				}

				container.addChild(new Spacer(1));
			}

			if (errorMessage) {
				container.addChild(new Text(theme.fg("warning", errorMessage), 1, 0));
			}
			container.addChild(new Text(theme.fg("dim", "↑↓ switch field • enter submit • esc cancel"), 1, 0));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			updateInputFocus();
		};

		const switchField = (nextIndex: number) => {
			activeIndex = nextIndex;
			rebuild();
		};

		rebuild();

		const component = {
			get focused() {
				return focused;
			},
			set focused(value: boolean) {
				focused = value;
				updateInputFocus();
			},
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
				rebuild();
			},
			handleInput(data: string) {
				if (kb.matches(data, "tui.select.cancel")) {
					done(undefined);
					return;
				}

				if (kb.matches(data, "tui.select.up") || matchesKey(data, Key.up)) {
					errorMessage = "";
					switchField(activeIndex === 0 ? command.args.length - 1 : activeIndex - 1);
					tui.requestRender();
					return;
				}

				if (kb.matches(data, "tui.select.down") || matchesKey(data, Key.down)) {
					errorMessage = "";
					switchField(activeIndex === command.args.length - 1 ? 0 : activeIndex + 1);
					tui.requestRender();
					return;
				}

				if (kb.matches(data, "tui.select.confirm") || matchesKey(data, Key.enter)) {
					const values = inputs.map((input) => input.getValue());
					const missingIndex = command.args.findIndex(
						(arg, index) => arg.required && values[index].trim().length === 0,
					);

					if (missingIndex !== -1) {
						errorMessage = `Required: ${command.args[missingIndex]?.name}`;
						switchField(missingIndex);
						tui.requestRender();
						return;
					}

					done({ values });
					return;
				}

				errorMessage = "";
				inputs[activeIndex]?.handleInput(data);
				tui.requestRender();
			},
		};

		return component;
	});

	if (!result) return { cancelled: true };

	const args: Record<string, string> = {};
	for (const [index, arg] of command.args.entries()) {
		const value = result.values[index]?.trim() ?? "";
		if (value) args[arg.name] = value;
	}
	return { args };
}

function buildPrompt(command: SourceCommand, argValues: Record<string, string>): string {
	let prompt = applyPlaceholders(command.body, getPiPlaceholders());
	const extraArgs: Array<{ name: string; value: string }> = [];

	for (const arg of command.args) {
		const value = argValues[arg.name];
		if (!value) continue;

		const token = `{{${arg.name}}}`;
		if (prompt.includes(token)) {
			prompt = prompt.replaceAll(token, value);
		} else {
			extraArgs.push({ name: arg.name, value });
		}
	}

	if (extraArgs.length > 0) {
		const lines = extraArgs.map((entry) => `- ${entry.name}: ${entry.value}`);
		prompt = `${prompt}\n\n## Focus Arguments\n${lines.join("\n")}`;
	}

	return prompt;
}

function splitInvocation(args: string): { commandName: string | null; rawTail: string } {
	const trimmed = args.trim();
	if (!trimmed) return { commandName: null, rawTail: "" };

	const firstSpace = trimmed.indexOf(" ");
	if (firstSpace === -1) return { commandName: trimmed, rawTail: "" };

	return {
		commandName: trimmed.slice(0, firstSpace),
		rawTail: trimmed.slice(firstSpace + 1).trim(),
	};
}

export default function impeccableExtension(pi: ExtensionAPI) {
	const commandOptions = {
		description: "Pick and run an Impeccable command from extension-local commands",
		getArgumentCompletions: (prefix: string) => {
			const commands = readSourceCommands();
			const invocation = splitInvocation(prefix);

			if (!invocation.commandName || !prefix.trim().includes(" ")) {
				const firstToken = (invocation.commandName ?? "").toLowerCase();
				const commandMatches = commands
					.filter((command) => command.name.toLowerCase().startsWith(firstToken))
					.map((command) => ({ value: command.name, label: command.name, description: command.description }));

				return commandMatches.length > 0 ? commandMatches : null;
			}

			const command = commands.find((item) => item.name === invocation.commandName);
			if (!command || command.args.length === 0) return null;

			const provided = parseInlineNamedArgs(invocation.rawTail);
			const providedKeys = new Set(Object.keys(provided));

			const suggestions = command.args
				.filter((arg) => !providedKeys.has(arg.name))
				.map((arg) => ({
					value: `${command.name} ${arg.name}=`,
					label: `${arg.name}=`,
					description: `${arg.required ? "required" : "optional"}${arg.description ? ` • ${arg.description}` : ""}`,
				}));

			return suggestions.length > 0 ? suggestions : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const commands = readSourceCommands();
			if (commands.length === 0) {
				ctx.ui.notify("No commands found in ./commands next to this extension", "error");
				return;
			}

			const pickerCommands = [...commands, getFrontendDesignPickerCommand()];
			const runCommand = async (selectedCommand: SourceCommand, seedArgs: Record<string, string>): Promise<boolean> => {
				if (selectedCommand.name === FRONTEND_DESIGN_PICKER_COMMAND_NAME) {
					const skillBlock = buildFrontendDesignSkillBlock();
					if (!skillBlock) {
						ctx.ui.notify("Could not load vendored frontend-design skill file", "error");
						return true;
					}

					pi.sendUserMessage(skillBlock);
					ctx.ui.notify("Running skill: frontend-design", "info");
					return true;
				}

				const argResult = await collectArgs(selectedCommand, ctx, seedArgs);
				if ("cancelled" in argResult) return false;

				const prompt = buildPrompt(selectedCommand, argResult.args);
				pi.sendUserMessage(prompt);
				ctx.ui.notify(`Running /${selectedCommand.name}`, "info");
				return true;
			};

			const invocation = splitInvocation(args);
			if (invocation.commandName) {
				const selectedCommand = pickerCommands.find((command) => command.name === invocation.commandName) ?? null;
				if (!selectedCommand) {
					ctx.ui.notify(`Unknown command: ${invocation.commandName}`, "error");
					return;
				}

				const prefilled: Record<string, string> = {};
				Object.assign(prefilled, parseInlineNamedArgs(invocation.rawTail));
				if (invocation.rawTail && selectedCommand.args.length === 1 && Object.keys(prefilled).length === 0) {
					prefilled[selectedCommand.args[0]!.name] = invocation.rawTail;
				}

				await runCommand(selectedCommand, prefilled);
				return;
			}

			while (true) {
				const selectedCommand = await pickCommand(pickerCommands, ctx);
				if (!selectedCommand) return;
				const completed = await runCommand(selectedCommand, {});
				if (!completed) continue;
				return;
			}
		},
	};

	pi.registerCommand("impeccable", commandOptions);
}
