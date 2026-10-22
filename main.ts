import { App, EditorSuggest, Notice, Plugin } from 'obsidian';

type ConfigVault = App['vault'] & { getConfig(name: string): unknown };

type LinkSuggest = EditorSuggest<unknown> & {
    app: App;
    suggestManager?: {
        getFileSuggestions?: unknown;
        getSuggestionsAsync?: unknown;
    };
};

export default class ManualWikilinkPlugin extends Plugin {
    onload() {
        let enabled = true;
        this.register(() => { enabled = false; });

        this.app.workspace.onLayoutReady(() => {
            if (!enabled) return;

            // Obsidian exposes no public hook for the native link completion format.
            const workspace = this.app.workspace as App['workspace'] & {
                editorSuggest?: { suggests?: LinkSuggest[] };
            };
            const candidates = workspace.editorSuggest?.suggests?.filter(suggest =>
                typeof suggest.suggestManager?.getFileSuggestions === 'function' &&
                typeof suggest.suggestManager?.getSuggestionsAsync === 'function' &&
                typeof suggest.selectSuggestion === 'function' &&
                typeof (suggest.app?.vault as ConfigVault)?.getConfig === 'function'
            ) ?? [];

            if (candidates.length !== 1) {
                new Notice('Wikilink Preserver: this Obsidian version has an incompatible link completer.');
                return;
            }

            const suggest = candidates[0];
            const original = suggest.selectSuggestion;
            const descriptor = Object.getOwnPropertyDescriptor(suggest, 'selectSuggestion');

            const selectSuggestion: LinkSuggest['selectSuggestion'] = function (this: LinkSuggest, value, event) {
                if (!enabled) return original.call(this, value, event);

                const app = this.app;
                const vault = new Proxy(app.vault as ConfigVault, {
                    get(target, key) {
                        if (key === 'getConfig') {
                            return (name: string) => name === 'useMarkdownLinks' ? false :
                                target.getConfig(name);
                        }
                        const value = Reflect.get(target, key, target);
                        return typeof value === 'function' ? value.bind(target) : value;
                    }
                });

                // Only this completion sees the override; the real app and saved settings stay intact.
                this.app = new Proxy(app, {
                    get(target, key) {
                        if (key === 'vault') return vault;
                        const value = Reflect.get(target, key, target);
                        return typeof value === 'function' ? value.bind(target) : value;
                    }
                });
                try {
                    return original.call(this, value, event);
                } finally {
                    this.app = app;
                }
            };

            suggest.selectSuggestion = selectSuggestion;
            this.register(() => {
                if (suggest.selectSuggestion !== selectSuggestion) return;
                if (descriptor) Object.defineProperty(suggest, 'selectSuggestion', descriptor);
                else delete (suggest as Partial<LinkSuggest>).selectSuggestion;
            });
        });
    }
}
