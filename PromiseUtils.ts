export class PromiseUtils {
	private static promiseMap: Map<string, PromiseUtils> = new Map();
	static has(key: string) {
		return this.promiseMap.has(key);
	}
	static get(key: string) {
		return this.promiseMap.get(key);
	}
	static remove(key: string, type?: "resolve", data?: any): void;
	static remove(key: string, type?: "reject", data?: Error): void;
	static remove(key: string, type?: "resolve" | "reject", data?: any) {
		let promiseUtils = this.promiseMap.get(key);
		if (!promiseUtils) {
			return;
		}
		if (type) {
			promiseUtils[type](data);
		} else {
			promiseUtils.clearAndDeleteFromMap();
		}
	}
	static add(key: string, timeOut?: number) {
		let promiseUtils = this.get(key);
		if (!promiseUtils) {
			promiseUtils = new PromiseUtils(key, timeOut);
			this.promiseMap.set(key, promiseUtils);
		}
		return promiseUtils.promise;
	}
	private resolveCall: (value?: any) => void;
	private rejectCall: (reason?: any) => void;
	private timerHandler?: number;
	private _key: string = "";
	private promise: Promise<any>;
	get key() {
		return this._key;
	}
	constructor(key?: string, timeOut?: number) {
		this._key = key;
		this.promise = new Promise((resolve, reject) => {
			this.resolveCall = resolve;
			this.rejectCall = reject;
			if (timeOut !== undefined && timeOut !== null) {
				this.timerHandler = setTimeout(() => {
					this.reject(new Error(`${key}: timeout`));
				}, timeOut);
			}
		});
	}
	resolve(value?: any) {
		this.clearAndDeleteFromMap();
		this.resolveCall(value);
	}
	reject(reason?: Error) {
		this.clearAndDeleteFromMap();
		this.rejectCall(reason);
	}
	private clearAndDeleteFromMap() {
		if (this.timerHandler !== undefined) {
			clearTimeout(this.timerHandler);
		}
		if (PromiseUtils.promiseMap.get(this.key) === this) {
			PromiseUtils.promiseMap.delete(this.key);
		}
	}
}
