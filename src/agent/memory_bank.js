export class MemoryBank {
    constructor(initialMemory = {}, onChange = null) {
        this.memory = initialMemory && typeof initialMemory === 'object'
            ? JSON.parse(JSON.stringify(initialMemory))
            : {};
        this.onChange = typeof onChange === 'function' ? onChange : null;
    }

    rememberPlace(name, x, y, z) {
        this.memory[name] = [x, y, z];
        this._changed();
    }

    forgetPlace(name) {
        const existed = Object.prototype.hasOwnProperty.call(this.memory, name);
        delete this.memory[name];
        if (existed)
            this._changed();
        return existed;
    }

    recallPlace(name) {
        return this.memory[name];
    }

    getJson() {
        return JSON.parse(JSON.stringify(this.memory));
    }

    loadJson(json) {
        this.memory = json && typeof json === 'object'
            ? JSON.parse(JSON.stringify(json))
            : {};
        this._changed();
    }

    getKeys() {
        return Object.keys(this.memory).join(', ');
    }

    _changed() {
        this.onChange?.(this.getJson());
    }
}
