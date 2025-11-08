import { Plugin, Editor, MarkdownView, MarkdownFileInfo, EditorPosition, EditorChange } from 'obsidian';
// Note: EditorChange might not be directly usable in the event handler signature,
// but we keep the import if needed elsewhere or for reference.

export default class ManualWikilinkPlugin extends Plugin {
    private isReplacing = false; // Flag to prevent recursion

    onload() {
        console.log('Loading Manual Wikilink Preserver Plugin');

        // Register the event listener with the corrected signature
        this.registerEvent(
            // The callback now receives the editor and view/file info
            this.app.workspace.on('editor-change', this.handleEditorChange)
        );
    }

    onunload() {
        console.log('Unloading Manual Wikilink Preserver Plugin');
    }

    /**
     * Handles the editor change event to detect and revert unwanted Wikilink->Markdown conversions.
     * This version works by inspecting the editor state *after* the change.
     * @param editor - The CodeMirror Editor instance where the change occurred.
     * @param info - Information about the markdown view or file.
     */
    private handleEditorChange = (editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
        if (this.isReplacing) {
            return; // Prevent reacting to own changes
        }

        // --- Condition 1: Check Obsidian's Link Setting ---
        // Use try-catch in case getConfig is problematic in the current environment/typings
        let useMarkdownLinks = false;
        try {
            // This is the documented way, should work.
            useMarkdownLinks = ((this.app.vault as any).getConfig('useMarkdownLinks'));
        } catch (e) {
            console.error("Manual Wikilink Preserver: Error accessing 'useMarkdownLinks' config. Assuming 'false'.", e);
            // If we can't get the setting reliably, we must exit to avoid unintended behavior.
            return;
        }

        // Only intervene if 'Use Wikilinks' is OFF (i.e., useMarkdownLinks is TRUE)
        if (!useMarkdownLinks) {
            return;
        }

        // --- Condition 2: Heuristic Detection after Change ---
        // Get current cursor position and line content
        const cursor = editor.getCursor();
        const lineText = editor.getLine(cursor.line);

        // Get the text from the start of the line up to the cursor
        const textBeforeCursor = lineText.substring(0, cursor.ch);

        // Regex to find a Markdown link pattern anywhere in the string
        // Removed the $ anchor to allow matching not just at the absolute end of the string
        // This regex captures:
        // Group 1: The display text (e.g., "Note" or "title1")
        // Group 2: The link path (e.g., "Note.md", "Note", or "Note#title1")
        const mdLinkRegex = /\[([^\]]+)\]\(([^)]+\)?)\)/;

        // Find the match in the text before the cursor
        const match = textBeforeCursor.match(mdLinkRegex);

        // Check if a match was found AND if this match ends exactly at the cursor position
        // This ensures we are only considering a Markdown link that was just completed or modified
        // right where the cursor is.
        if (match) {
            const fullMatchText = match[0]; // The entire matched markdown link, e.g., "[Note](Note.md)"
            const matchEndIndex = match.index + fullMatchText.length;

            // If the match ends exactly where the cursor is, it's likely the link we care about
            if (matchEndIndex === cursor.ch) {
                const displayText = match[1];   // Captured display text, e.g., "Note" or "title1"
                const linkPath = match[2];       // Captured path, e.g., "Note.md", "Note", or "Note#title1"

                // Decode the URL-encoded path
                const decodedLinkPath = decodeURIComponent(linkPath);

                // Determine the base name of the link (file name without .md and without heading/block ref)
                let linkBaseName = decodedLinkPath;
                const lastSlashIndex = linkBaseName.lastIndexOf('/');
                if (lastSlashIndex !== -1) {
                    linkBaseName = linkBaseName.substring(lastSlashIndex + 1);
                }
                const hashIndex = linkBaseName.indexOf('#');
                if (hashIndex !== -1) {
                    linkBaseName = linkBaseName.substring(0, hashIndex);
                }
                if (linkBaseName.toLowerCase().endsWith('.md')) {
                    linkBaseName = linkBaseName.substring(0, linkBaseName.length - 3);
                }

                // --- Condition 3: Check if Display Text matches Link Base Name OR Heading/Block Reference ---
                // This is the core heuristic: if they match, it was likely an auto-conversion
                // from a [[Wikilink]] selection.

                let isAutoConvertedWikilink = false;

                // Case 1: Simple link (e.g., [[mydoc]] -> [mydoc](mydoc.md))
                // Display text should match the link base name
                if (displayText === linkBaseName) {
                    isAutoConvertedWikilink = true;
                }

                // Case 2: Link with heading or block reference (e.g., [[mydoc#title1]] -> [title1](mydoc#title1))
                // Display text should match the text after the '#' in the decoded link path
                if (!isAutoConvertedWikilink && hashIndex !== -1) {
                    const headingOrBlockRef = decodedLinkPath.substring(hashIndex + 1);
                    if (displayText === headingOrBlockRef) {
                        isAutoConvertedWikilink = true;
                    }
                    // This 'else' catches cases where displayText != headingOrBlockRef,
                    // which happens when Obsidian slugifies a heading (e.g., with a colon).
                    else {
                        isAutoConvertedWikilink = true;
                    }
                }


                if (isAutoConvertedWikilink) {
                    // Construct the Wikilink to replace the Markdown link
                    // We need to reconstruct the original wikilink format, including the reference if present.
                    let originalWikilinkContent = linkBaseName; // Start with the file name
                    if (hashIndex !== -1) {
                        originalWikilinkContent += "#" + displayText;
                    }

                    const wikilink = `[[${originalWikilinkContent}]]`;


                    // Calculate the start position of the Markdown link to be replaced
                    // The match.index gives the start position of the match within textBeforeCursor
                    const fromPos: EditorPosition = {
                        line: cursor.line,
                        ch: match.index // Use the index of the match within the line
                    };

                    // The end position is the current cursor position
                    const toPos: EditorPosition = cursor;

                    // Perform the replacement
                    this.isReplacing = true;
                    try {
                        editor.replaceRange(wikilink, fromPos, toPos);

                        // Optional: Adjust cursor to be after the inserted wikilink
                        // (This might already be handled correctly by replaceRange, but explicit positioning is safer)
                        const newCursorPos: EditorPosition = {
                            line: fromPos.line,
                            ch: fromPos.ch + wikilink.length
                        };
                        editor.setCursor(newCursorPos);

                        // console.log(`Manual Wikilink Preserver: Reverted "${fullMatchText}" to "${wikilink}"`);

                    } finally {
                        // Use requestAnimationFrame to reset the flag *after* the current event cycle
                        // This is important to avoid the plugin reacting to its own replacement.
                        requestAnimationFrame(() => {
                            this.isReplacing = false;
                        });
                    }
                }
            }
        }
    }
}
