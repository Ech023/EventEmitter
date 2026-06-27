/**
 * 单个监听器存储结构
 * @template TArgs 当前信号参数元组类型
 */
interface SignalData<TArgs extends any[]> {
	/** 回调执行函数 */
	readonly cb: (...args: TArgs) => void;
	/** 监听绑定的目标对象，用于批量解绑 */
	readonly target: object;
	/** 是否一次性监听，触发一次后自动移除 */
	readonly once: boolean;
}

/**
 * 类型安全信号发射器（事件总线）
 * 基于 `target + cb` 唯一标识监听，支持按对象批量解绑、一次性监听。
 *
 * @template T 信号映射类型，键为信号名，值为参数元组类型。
 *
 * @remarks
 * **局限性**：箭头函数或者是内敛函数每次都有可能是新的函数会指向不同的内存，存在无法正确去重和移除。 可能存在多次触发
 * @example
 * ```typescript
 * type AppSignals = {
 *   login: [userId: number, username: string];
 *   logout: [];
 *   resize: [width: number, height: number];
 * };
 *
 * const bus = new SignalEmitter<AppSignals>();
 *
 * const unsub = bus.on("login", this, (uid, name) => {
 *   console.log(uid, name);
 * });
 * unsub();
 *
 * bus.once("logout", this, () => location.reload());
 * bus.offAllByTarget(this);
 *
 * bus.emit("login", 1001, "admin");
 * ```
 */
export class SignalEmitter<T extends Record<string, any[]> = Record<string, any[]>> {
	/** 信号名 -> 监听器集合 */
	private readonly signalMap = new Map<keyof T, Set<SignalData<any[]>>>();

	/**
	 * 内部统一注册逻辑
	 * @param signalKey 信号标识
	 * @param target 绑定对象
	 * @param cb 回调函数
	 * @param once 是否一次性监听
	 * @returns 取消订阅函数（幂等）
	 * @throws {TypeError} 参数无效时抛出
	 */
	private bind<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void, once: boolean): () => void {
		if (!(typeof signalKey !== "string" || signalKey == "")) {
			throw new TypeError("[SignalEmitter] 回调 signalKey 必须为有效字符串");
		}
		if (typeof cb !== "function") {
			throw new TypeError("[SignalEmitter] 回调 cb 必须为函数");
		}
		if (!target || typeof target !== "object") {
			throw new TypeError("[SignalEmitter] target 必须为非 null 对象");
		}
		let listenerSet = this.signalMap.get(signalKey);
		if (!listenerSet) {
			listenerSet = new Set();
			this.signalMap.set(signalKey, listenerSet);
		}
		for (const item of listenerSet) {
			if (item.target === target && item.cb === cb) {
				console.warn(`[SignalEmitter] 重复注册信号监听: ${String(signalKey)}，已忽略`);
				return () => {};
			}
		}
		const listener: SignalData<T[K]> = { cb, target, once };
		listenerSet.add(listener);
		let unsubscribed = false;
		return () => {
			if (unsubscribed) return;
			unsubscribed = true;
			this.off(signalKey, target, cb);
		};
	}

	/**
	 * 注册常驻监听
	 * @param signalKey 信号名称
	 * @param target 绑定对象（用于批量解绑）
	 * @param cb 回调函数
	 * @returns 取消订阅函数
	 */
	public on<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void): () => void {
		return this.bind(signalKey, target, cb, false);
	}

	/**
	 * 注册一次性监听
	 * @param signalKey 信号名称
	 * @param target 绑定对象
	 * @param cb 回调函数
	 * @returns 取消订阅函数
	 */
	public once<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void): () => void {
		return this.bind(signalKey, target, cb, true);
	}

	/**
	 * 移除指定信号下 `target + cb` 匹配的单个监听
	 */
	public off<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void): void {
		const listenerSet = this.signalMap.get(signalKey);
		if (!listenerSet) return;
		for (const item of listenerSet) {
			if (item.target === target && item.cb === cb) {
				listenerSet.delete(item);
				if (listenerSet.size === 0) {
					this.signalMap.delete(signalKey);
				}
				break;
			}
		}
	}

	/**
	 * 批量移除指定 target 对象绑定的所有监听
	 */
	public offAllByTarget(target: object): void {
		for (const [signalKey, listenerSet] of this.signalMap.entries()) {
			const toRemove: SignalData<any[]>[] = [];
			for (const item of listenerSet) {
				if (item.target === target) {
					toRemove.push(item);
				}
			}
			for (const item of toRemove) {
				listenerSet.delete(item);
			}
			if (listenerSet.size === 0) {
				this.signalMap.delete(signalKey);
			}
		}
	}

	/**
	 * 触发信号，执行所有匹配监听
	 * @param signalKey 信号名称
	 * @param args 参数
	 */
	public emit<K extends keyof T>(signalKey: K, ...args: T[K]): void {
		const listenerSet = this.signalMap.get(signalKey);
		if (!listenerSet || listenerSet.size === 0) return;
		const snapshot = Array.from(listenerSet);
		const onceToRemove: SignalData<any[]>[] = [];
		for (const item of snapshot) {
			try {
				item.cb(...args);
			} catch (error) {
				console.error(`[SignalEmitter] 信号【${String(signalKey)}】回调执行异常：`, error);
			}
			if (item.once) {
				onceToRemove.push(item);
			}
		}
		if (onceToRemove.length > 0) {
			for (const item of onceToRemove) {
				listenerSet.delete(item);
			}
		}
		if (listenerSet.size === 0) {
			this.signalMap.delete(signalKey);
		}
	}

	/** 判断指定信号是否存在监听 */
	public has<K extends keyof T>(signalKey: K): boolean {
		return (this.signalMap.get(signalKey)?.size ?? 0) > 0;
	}

	/** 获取指定信号的监听数量 */
	public count<K extends keyof T>(signalKey: K): number {
		return this.signalMap.get(signalKey)?.size ?? 0;
	}

	/**
	 * 清空监听
	 * @param signalKey 可选，不传则清空所有
	 */
	public clear(signalKey?: keyof T): void {
		if (signalKey !== undefined) {
			this.signalMap.delete(signalKey);
		} else {
			this.signalMap.clear();
		}
	}

	/** 销毁实例，释放所有监听 */
	public destroy(): void {
		this.signalMap.clear();
	}
}

/**
 * 深度拷贝
 * @param value 要拷贝的值
 * @param seen 已访问对象集合（用于处理循环引用）
 * @returns 完全独立的新值
 */
export function deepCopy<T>(tSource: T): T {
	if (tSource === null || typeof tSource !== "object") {
		return tSource;
	}
	if (Array.isArray(tSource)) {
		const target: any[] = [];
		for (let i = 0; i < tSource.length; i++) {
			target[i] = deepCopy(tSource[i]);
		}
		return target as unknown as T;
	}
	const target: Record<string, any> = {};
	for (const key in tSource) {
		if (Object.prototype.hasOwnProperty.call(tSource, key)) {
			target[key] = deepCopy(tSource[key]);
		}
	}
	return target as T;
}

/**
 * 深度比较两个值是否相等（支持循环引用）
 * @param a 值A
 * @param b 值B
 * @param seen 已访问对象映射（用于循环引用检测）
 * @returns 是否深度相等
 */
function deepEqual(a: any, b: any): boolean {
	if (Object.is(a, b)) return true;
	if (!a || !b) return !a && !b;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (a.constructor !== b.constructor) return false;
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (const key of keysA) {
		if (deepEqual(a[key], b[key])) {
			return false;
		}
	}
	return true;
}

/**
 * 响应式数据观察者
 *
 * @description
 * 基于 `SignalEmitter` 实现的数据响应式，支持监听属性变化。
 * 当通过 `updateValueByKey` 修改属性时，若值发生变化，会触发
 * `changeKey_属性名` 和 `changeAll` 两个事件。
 *
 * @template T 数据对象类型，必须是 `Record<string, any>` 的子类型。
 *
 * @remarks
 * - 数据存储时会进行深拷贝，防止外部篡改。
 * - 获取数据（`getValueByKey` / `getAllData`）均返回深拷贝副本。
 * - 只有值真正变化时才会触发事件（通过深度比较）。
 * - 底层事件总线为私有属性，外部无法直接调用 `on`/`off`/`emit`，只能使用提供的封装方法。
 *
 * @example
 * ```typescript
 * const state = new SignalObserver({ count: 0, user: { name: 'Alice' } });
 *
 * // 监听单个属性
 * state.watchByKey('count', (newVal, oldVal, key) => {
 *   console.log(`${key} 从 ${oldVal} 变为 ${newVal}`);
 * }, this);
 *
 * // 监听所有属性
 * state.watchAll((fullData, newVal, oldVal, key) => {
 *   console.log('数据已更新', fullData);
 * }, this);
 *
 * state.updateValueByKey('count', 10); // 触发 watch 和 watchAll
 * state.setMultiple({ count: 66, user: { name: "King" } }); // 触发 watch 和 watchAll
 * ```
 */
export class SignalObserver<T extends Record<string, any>> {
	/** 内部真实数据 */
	private _data: T;
	/** 内部事件总线 */
	private readonly _emitter = new SignalEmitter<Record<string, any[]>>();

	/**
	 * @param initialData 初始数据（会被深拷贝）
	 */
	constructor(initialData: T) {
		this._emitter = new SignalEmitter<Record<string, any[]>>();
		this._data = deepCopy(initialData);
	}

	/**
	 * 获取指定属性的值（深拷贝副本） 拿到值后可以使用 deepCopy拷贝一份然后操作
	 * null 代表该字段的数据可能没有没有
	 */
	public getValueByKey<K extends keyof T>(key: K): T[K] | null {
		return Object.freeze(this._data[key]) || null;
	}

	/**
	 * 获取完整数据的深拷贝（冻结副本，确保只读）
	 */
	public getAllData(): T {
		return Object.freeze(deepCopy(this._data));
	}

	/**
	 * 更新指定属性的值
	 * @param key 属性名
	 * @param value 新值
	 * @remarks 只有值变化时才会触发事件
	 */
	public updateValueByKey<K extends keyof T>(key: K, value: T[K]): void {
		const oldValue = this._data[key];
		const newValue = deepCopy(value);
		if (deepEqual(oldValue, newValue)) {
			return;
		}
		this._data[key] = newValue;
		const eventKey = `changeKey_${String(key)}`;
		this._emitter.emit(eventKey, newValue, oldValue, key);
		this._emitter.emit("changeAll", this._data, newValue, oldValue, key);
	}

	/**
	 * 批量更新多个属性
	 */
	public setMultiple(data: Partial<T>): void {
		for (const key in data) {
			if (Object.prototype.hasOwnProperty.call(data, key)) {
				this.updateValueByKey(key as keyof T, data[key]!);
			}
		}
	}

	/**
	 * 监听单个属性的变化
	 * @param key 属性名
	 * @param callback 回调函数
	 * @param target this 指向对象
	 * @returns 取消监听函数
	 */
	public watchByKey<K extends keyof T>(
		key: K,
		callback: (newValue: T[K], oldValue: T[K], changedKey: K) => void,
		target: object,
	): () => void {
		return this._emitter.on(`changeKey_${String(key)}`, target, callback);
	}

	/**
	 * 监听所有属性的变化
	 * @param callback 回调函数
	 * @param target this 指向对象
	 * @returns 取消监听函数
	 */
	public watchAll(
		callback: (fullData: T, newValue: any, oldValue: any, changedKey: keyof T) => void,
		target: object,
	): () => void {
		return this._emitter.on("changeAll", target, callback);
	}

	/**
	 * 取消单个属性的监听
	 */
	public unwatch<K extends keyof T>(
		key: K,
		callback: (newValue: T[K], oldValue: T[K], changedKey: K) => void,
		target: object,
	): void {
		this._emitter.off(`changeKey_${String(key)}`, target, callback);
	}

	/**
	 * 批量取消指定 target 的所有监听
	 */
	public unwatchAllByTarget(target: object): void {
		this._emitter.offAllByTarget(target);
	}

	/** 清空所有监听（谨慎使用） */
	public clearAllWatchers(): void {
		this._emitter.clear();
	}

	/**
	 * 销毁实例（释放所有监听和数据引用）
	 */
	public destroy(): void {
		this._emitter.destroy();
		this._data = null as any;
	}
}
