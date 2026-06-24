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
 * **局限性**：回调函数请勿使用箭头函数，因为每次定义都会产生新的函数引用，
 * 导致无法正确去重和移除。
 *
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
 * // 注册常驻监听
 * const unsub = bus.on("login", this, (uid, name) => {
 *   console.log(uid, name);
 * });
 * // 取消监听
 * unsub();
 *
 * // 一次性监听
 * bus.once("logout", this, () => location.reload());
 *
 * // 组件销毁时批量解绑
 * bus.offAllByTarget(this);
 *
 * // 触发信号
 * bus.emit("login", 1001, "admin");
 * ```
 */
export class SignalEmitter<T extends Record<string, any[]> = Record<string, any[]>> {
	/** 空操作函数，用于无操作返回 */
	private static readonly NOOP = () => void 0;

	/** 信号名 -> 对应监听器集合 */
	private readonly signalMap = new Map<keyof T, Set<SignalData<any[]>>>();

	/**
	 * 内部统一注册监听逻辑
	 *
	 * @param signalKey 信号标识
	 * @param target 绑定对象
	 * @param cb 回调函数
	 * @param once 是否一次性监听
	 * @returns 取消订阅函数（幂等，多次调用无副作用）
	 * @throws {TypeError} 当参数类型无效时抛出
	 */
	private bind<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void, once: boolean): () => void {
		if (typeof signalKey !== "string" || !signalKey) {
			throw new TypeError("[SignalEmitter] signalKey 必须为有效字符串key");
		}
		if (typeof cb !== "function") {
			throw new TypeError("[SignalEmitter] 监听回调 cb 必须为函数");
		}
		if (typeof target !== "object" || !target) {
			throw new TypeError("[SignalEmitter] target 必须为非 null 对象");
		}
		let listenerSet = this.signalMap.get(signalKey);
		if (!listenerSet) {
			listenerSet = new Set();
			this.signalMap.set(signalKey, listenerSet);
		}
		// 校验重复监听：同一 target + 同一 cb 不重复注册
		const duplicate = Array.from(listenerSet).some(item => item.target === target && item.cb === cb);
		if (duplicate) {
			console.warn(`[SignalEmitter] 重复注册信号监听: ${String(signalKey)}，本次注册已忽略`);
			return SignalEmitter.NOOP;
		}

		const listener: SignalData<T[K]> = { cb, target, once };
		listenerSet.add(listener);

		let isUnsubscribed = false;
		return () => {
			if (isUnsubscribed) return;
			isUnsubscribed = true;
			this.off(signalKey, target, cb);
		};
	}

	/**
	 * 注册常驻监听
	 *
	 * @param signalKey 信号名称
	 * @param target 绑定对象（用于批量解绑）
	 * @param cb 回调函数
	 * @returns 取消订阅函数
	 *
	 * @remarks
	 * 存在多次回调函数绑定请勿使用箭头函数，否则会因引用变化导致无法去重。可能导致触发多次
	 *
	 * @example
	 * ```typescript
	 * const unsub = bus.on("login", this, (uid, name) => {
	 *   console.log(`用户 ${name}(${uid}) 登录`);
	 * });
	 * ```
	 */
	public on<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void): () => void {
		return this.bind(signalKey, target, cb, false);
	}

	/**
	 * 注册一次性监听，触发一次后自动解绑
	 *
	 * @param signalKey 信号名称
	 * @param target 绑定对象
	 * @param cb 回调函数
	 * @returns 取消订阅函数
	 *
	 * @example
	 * ```typescript
	 * bus.once("logout", this, () => {
	 *   console.log("用户已登出，仅执行一次");
	 * });
	 * ```
	 */
	public once<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void): () => void {
		return this.bind(signalKey, target, cb, true);
	}

	/**
	 * 移除指定信号下 `target + cb` 匹配的单个监听
	 *
	 * @param signalKey 信号名称
	 * @param target 绑定对象
	 * @param cb 注册时传入的回调函数
	 *
	 * @example
	 * ```typescript
	 * const handler = (uid, name) => { ... };
	 * bus.on("login", this, handler);
	 * // 移除
	 * bus.off("login", this, handler);
	 * ```
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
	 * 批量移除指定 target 对象绑定的所有信号监听
	 *
	 * @param target 绑定对象
	 *
	 * @example
	 * ```typescript
	 * // 组件卸载时清理所有监听
	 * bus.offAllByTarget(this);
	 * ```
	 */
	public offAllByTarget(target: object): void {
		const signalEntries = Array.from(this.signalMap.entries());
		for (const [signalKey, listenerSet] of signalEntries) {
			const toRemove: SignalData<any[]>[] = [];
			for (const item of listenerSet) {
				if (item.target === target) {
					toRemove.push(item);
				}
			}
			toRemove.forEach(item => listenerSet.delete(item));
			if (listenerSet.size === 0) {
				this.signalMap.delete(signalKey);
			}
		}
	}

	/**
	 * 触发信号，执行所有匹配监听回调
	 *
	 * @param signalKey 信号名称
	 * @param args 信号携带参数
	 *
	 * @remarks
	 * - 一次性监听在执行后会被自动移除。
	 * - 任何回调执行异常都会被捕获并输出到控制台，不会中断其他监听。
	 *
	 * @example
	 * ```typescript
	 * bus.emit("login", 1001, "admin");
	 * bus.emit("resize", 1920, 1080);
	 * ```
	 */
	public emit<K extends keyof T>(signalKey: K, ...args: T[K]): void {
		const listenerSet = this.signalMap.get(signalKey);
		if (!listenerSet?.size) return;

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

		for (const item of onceToRemove) {
			listenerSet.delete(item);
		}
		if (listenerSet.size === 0) {
			this.signalMap.delete(signalKey);
		}
	}

	/**
	 * 判断指定信号是否存在监听
	 *
	 * @param signalKey 信号名称
	 * @returns 是否存在至少一个监听
	 *
	 * @example
	 * ```typescript
	 * if (bus.has("login")) {
	 *   console.log("有登录监听");
	 * }
	 * ```
	 */
	public has<K extends keyof T>(signalKey: K): boolean {
		return (this.signalMap.get(signalKey)?.size ?? 0) > 0;
	}

	/**
	 * 获取指定信号当前监听数量
	 *
	 * @param signalKey 信号名称
	 * @returns 监听器个数
	 *
	 * @example
	 * ```typescript
	 * const count = bus.count("login");
	 * console.log(`登录监听数量：${count}`);
	 * ```
	 */
	public count<K extends keyof T>(signalKey: K): number {
		return this.signalMap.get(signalKey)?.size ?? 0;
	}

	/**
	 * 清空监听
	 *
	 * @param signalKey 可选，传入信号名则仅清空该信号，不传则清空全部信号
	 *
	 * @example
	 * ```typescript
	 * bus.clear("login");    // 只清空 login
	 * bus.clear();           // 清空所有
	 * ```
	 */
	public clear(signalKey?: keyof T): void {
		if (signalKey !== undefined) {
			this.signalMap.delete(signalKey);
			return;
		}
		this.signalMap.clear();
	}

	/**
	 * 实例销毁：清空所有监听，释放全部引用
	 *
	 * @example
	 * ```typescript
	 * bus.destroy();
	 * ```
	 */
	public destroy(): void {
		this.signalMap.clear();
	}
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
 * ```
 */
export class SignalObserver<T extends Record<string, any>> {
	/** 内部真实数据（深拷贝存储） */
	private _data: T;
	/** 内部事件总线（私有，外部无法访问） */
	private _emitter = new SignalEmitter<Record<string, any[]>>();

	/**
	 * 创建响应式数据实例
	 *
	 * @param initialData 初始数据对象，会被深拷贝存储
	 */
	constructor(initialData: T) {
		this._data = this._deepCopy(initialData);
	}

	/**
	 * 对象深拷贝（递归拷贝所有可枚举属性）
	 *
	 * @param tSource 要拷贝的源数据
	 * @returns 完全独立的新对象
	 * @internal
	 */
	private _deepCopy<T>(tSource: T): T {
		if (tSource === null || typeof tSource !== "object") {
			return tSource;
		}
		if (Array.isArray(tSource)) {
			const target: any[] = [];
			for (let i = 0; i < tSource.length; i++) {
				target[i] = this._deepCopy(tSource[i]);
			}
			return target as unknown as T;
		}
		const target: Record<string, any> = {};
		for (const key in tSource) {
			if (Object.prototype.hasOwnProperty.call(tSource, key)) {
				target[key] = this._deepCopy(tSource[key]);
			}
		}
		return target as T;
	}

	/**
	 * 深度比较两个值是否相等（支持对象/数组/Date/Map/Set/RegExp，最大递归深度10层）
	 *
	 * @param a 比较值 A
	 * @param b 比较值 B
	 * @param depth 当前递归深度（内部使用）
	 * @returns 是否深度相等
	 * @internal
	 */
	private _deepEqual(a: any, b: any, depth = 0): boolean {
		const MAX_DEPTH = 10;
		if (depth > MAX_DEPTH) return Object.is(a, b);
		if (Object.is(a, b)) return true;
		if (!a || !b) return !a && !b;
		if (typeof a !== "object" || typeof b !== "object") return false;
		if (a.constructor !== b.constructor) return false;
		const keysA = Object.keys(a);
		const keysB = Object.keys(b);
		if (keysA.length !== keysB.length) return false;
		for (const key of keysA) {
			if (!this._deepEqual(a[key], b[key], depth + 1)) {
				return false;
			}
		}
		return true;
	}

	/**
	 * 获取指定属性的值（返回深拷贝副本）
	 *
	 * @param key 属性名
	 * @returns 对应值的深拷贝副本（只读）
	 *
	 * @example
	 * ```typescript
	 * const count = state.getValueByKey('count'); // 返回副本，修改不影响原数据
	 * ```
	 */
	public getValueByKey<K extends keyof T>(key: K): T[K] {
		return this.getAllData()[key];
	}

	/**
	 * 获取完整数据（深拷贝并冻结）
	 *
	 * @returns 完整数据的深拷贝冻结副本，确保只读
	 *
	 * @example
	 * ```typescript
	 * const snapshot = state.getAllData();
	 * // snapshot 为只读，任何修改都会在严格模式下报错
	 * ```
	 */
	public getAllData(): T {
		return Object.freeze(this._deepCopy(this._data));
	}

	/**
	 * 设置数据（始终更新，存在监听则触发事件）
	 *
	 * @param key 属性名
	 * @param value 新值
	 *
	 * @remarks
	 * - 存储前会对 `value` 进行深拷贝，确保内部数据不受外部影响。
	 * - 仅当新值与旧值不相等（深度比较）时，才会触发 `changeKey_*` 和 `changeAll` 事件。
	 * - 即使无监听，数据也会被更新。
	 *
	 * @example
	 * ```typescript
	 * state.updateValueByKey('count', 100);
	 * ```
	 */
	public updateValueByKey<K extends keyof T>(key: K, value: T[K]): void {
		const oldValue = this._data[key];
		const newValue = this._deepCopy(value);
		const isEqual = typeof newValue === "object" ? this._deepEqual(oldValue, newValue) : Object.is(oldValue, newValue);
		if (isEqual) return;
		this._data[key] = newValue;

		const eventKey = `changeKey_${String(key)}`;
		// 仅在存在监听时触发，避免无谓的事件派发
		if (this._emitter.has(eventKey)) {
			this._emitter.emit(eventKey, newValue, oldValue, key);
		}
		if (this._emitter.has("changeAll")) {
			this._emitter.emit("changeAll", this._deepCopy(this._data), newValue, oldValue, key);
		}
	}

	/**
	 * 批量设置数据
	 *
	 * @param data 部分数据对象，会依次调用 `updateValueByKey`
	 *
	 * @example
	 * ```typescript
	 * state.setMultiple({ count: 10, user: { name: 'Bob' } });
	 * ```
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
	 *
	 * @param key 要监听的属性名
	 * @param callback 回调函数，参数为 `(newValue, oldValue, changedKey)`
	 * @param target 回调中 `this` 的指向对象（用于后续批量解绑）
	 * @returns 取消监听的函数（调用后该监听被移除）
	 *
	 * @remarks
	 * 回调函数请勿使用箭头函数，否则会因引用变化导致无法正确移除。
	 *
	 * @example
	 * ```typescript
	 * const unlisten = state.watchByKey('count', (newVal, oldVal, key) => {
	 *   console.log(`${key} changed: ${oldVal} -> ${newVal}`);
	 * }, this);
	 * // 取消监听
	 * unlisten();
	 * ```
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
	 *
	 * @param callback 回调函数，参数为 `(fullData, newValue, oldValue, changedKey)`
	 * @param target 回调中 `this` 的指向对象
	 * @returns 取消监听的函数
	 *
	 * @remarks
	 * 回调函数请勿使用箭头函数。
	 *
	 * @example
	 * ```typescript
	 * state.watchAll((fullData, newVal, oldVal, key) => {
	 *   console.log(`属性 ${key} 由 ${oldVal} 变为 ${newVal}，当前数据：`, fullData);
	 * }, this);
	 * ```
	 */
	public watchAll(
		callback: (fullData: T, newValue: any, oldValue: any, changedKey: keyof T) => void,
		target: object,
	): () => void {
		return this._emitter.on("changeAll", target, callback);
	}

	/**
	 * 取消单个属性的监听
	 *
	 * @param key 属性名
	 * @param callback 注册时传入的回调函数（必须是同一个函数引用）
	 * @param target 注册时绑定的 `this` 对象（必须一致）
	 *
	 * @example
	 * ```typescript
	 * const handler = (newVal, oldVal, key) => { ... };
	 * state.watchByKey('count', handler, this);
	 * // 取消
	 * state.unwatch('count', handler, this);
	 * ```
	 */
	public unwatch<K extends keyof T>(
		key: K,
		callback: (newValue: T[K], oldValue: T[K], changedKey: K) => void,
		target: object,
	): void {
		this._emitter.off(`changeKey_${String(key)}`, target, callback);
	}

	/**
	 * 批量取消指定 `target` 对象的所有监听（通常用于组件卸载时清理）
	 *
	 * @param target 注册时绑定的 `this` 对象
	 *
	 * @example
	 * ```typescript
	 * // 组件销毁时清理所有监听
	 * state.unwatchAllByTarget(this);
	 * ```
	 */
	public unwatchAllByTarget(target: object): void {
		this._emitter.offAllByTarget(target);
	}

	/**
	 * 清空所有监听（谨慎使用）
	 *
	 * @remarks
	 * 会移除所有 `watch` 和 `watchAll` 注册的回调，且无法恢复。
	 *
	 * @example
	 * ```typescript
	 * state.clearAllWatchers();
	 * ```
	 */
	public clearAllWatchers(): void {
		this._emitter.clear();
	}

	/**
	 * 销毁实例，释放所有监听引用
	 *
	 * @remarks
	 * 清空所有监听并释放内部数据引用（数据置为 `null`），便于垃圾回收。
	 * 调用后该实例不再可用。
	 *
	 * @example
	 * ```typescript
	 * state.destroy();
	 * ```
	 */
	public destroy(): void {
		this._emitter.destroy();
		// 释放数据引用，帮助 GC
		(this as any)._data = null;
	}
}
