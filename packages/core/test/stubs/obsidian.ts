export class App {}
export class Plugin {
  app: App = new App();
  async loadData(): Promise<any> { return {}; }
  async saveData(_data: any): Promise<void> {}
  addCommand(_cmd: any): void {}
  addSettingTab(_tab: any): void {}
}
export class PluginSettingTab {
  containerEl: any = { empty() {}, createEl() {} };
  constructor(public app: App, public plugin: any) {}
  display(): void {}
}
export class Setting {
  constructor(_el: any) {}
  setName(_n: string): this { return this; }
  setDesc(_d: string): this { return this; }
  addText(_cb: any): this { return this; }
}
export class SuggestModal<T> {
  constructor(_app: App) {}
  setPlaceholder(_p: string): void {}
  open(): void {}
  // getSuggestions, renderSuggestion, onChooseSuggestion declared by subclass
}
export class Notice {
  constructor(_msg: string) {}
}
