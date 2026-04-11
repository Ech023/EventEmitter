namespace EventEmit {
	/** 回调信息存储结构，用于内部维护每个事件监听器的详细信息*/
	interface EventInfo {
		/** 原始回调函数（未绑定的） */
		func: (...args: any[]) => void;
		/** 绑定的 this 对象，用于在回调中保持正确的上下文 */
		target: any;
		/** 是否为一次性监听（触发后自动移除） */
		once: boolean;
		/** 经过 bind 后的实际执行函数（已绑定 this） */
		boundFunc: (...args: any[]) => void;
		/** 批量注册时的分组标识（普通注册时为空字符串） */
		batchKey: string;
	}

	export class EventListen {
		/** 内部存储：事件类型 -> 回调信息列表 */
		private _eventMap: Map<string, EventInfo[]> = new Map();
		/**
		 * 注册事件监听。如果相同 type、相同 callback、相同 target 的监听已存在，则不会重复注册。
		 * @param type - 事件类型（必须为非空字符串）
		 * @param callback - 回调函数 如果该回调绑定了this target可以不穿
		 * @param target - 可选，绑定的 this 对象（回调中的 this 将指向该对象）
		 * @param once - 可选，是否一次性监听（默认为 false）
		 * @param batchKey - 可选，批量分组标识（供 onBatch 内部使用，普通调用请留空）
		 * @example
		 * ```typescript
		 * // 普通注册，绑定 this 为当前组件
		 * eventTarget.on('click', this.onClick, this);
		 * // 一次性监听
		 * eventTarget.on('init', this.onInit, this, true);
		 * ```
		 */
		public on(type: string, callback: (...args: any[]) => void, target: any = undefined, once: boolean = false, batchKey: string = "") {
			if (typeof type !== "string" || type === "") {
				console.warn("[EventListen] type 必须是有效非空字符串");
				return;
			}
			if (typeof callback !== "function") {
				console.warn("[EventListen] callback 必须是函数");
				return;
			}
			const boundFunc = target ? callback.bind(target) : callback;
			const _info: EventInfo = { func: callback, target, once, boundFunc, batchKey };
			if (!this._eventMap.has(type)) {
				this._eventMap.set(type, []);
			}
			const list = this._eventMap.get(type)!;
			const exists = list.some(info => info.target === target && info.func === callback);
			if (!exists) {
				list.push(_info);
			}
		}

		/**
		 * 注册一次性事件监听（触发一次后自动移除）。
		 * @param type - 事件类型
		 * @param callback - 回调函数
		 * @param target - 可选，绑定的 this 对象
		 * @example
		 * ```typescript
		 * eventTarget.once('loaded', this.onLoaded, this);
		 * ```
		 */
		public once(type: string, callback: (...args: any[]) => void, target: any = undefined) {
			this.on(type, callback, target, true);
		}

		/**
		 * 批量注册事件（分组注册）。所有通过 onBatch 注册的事件会携带相同的 batchKey，便于统一管理。
		 *
		 * @param batchKey - 分组标识（必须为非空字符串），用于后续通过 offBatch 批量移除
		 * @param events - 事件配置数组，每个元素包含 type, callback, target(可选), once(可选)
		 * @example
		 * ```typescript
		 * eventTarget.onBatch('playerGroup', [
		 *     { type: 'levelUp', callback: this.onLevelUp, target: this },
		 *     { type: 'death', callback: this.onDeath, target: this, once: true }
		 * ]);
		 * ```
		 */
		public onBatch(batchKey: string, events: Array<{ type: string; callback: (...args: any[]) => void; target?: any; once?: boolean }>): void {
			if (typeof batchKey !== "string" || batchKey === "") {
				console.warn("[EventListen] onBatch: key 必须是有效非空字符串");
				return;
			}
			for (const ev of events) {
				this.on(ev.type, ev.callback, ev.target, ev.once, batchKey);
			}
		}

		/**
		 * 批量移除事件（按分组标识）。
		 * @param batchKey - 分组标识（必须为非空字符串），将与回调信息中的 batchKey 匹配
		 * @example
		 * ```typescript
		 * // 移除 'playerGroup' 分组下注册的所有事件
		 * eventTarget.offBatch('playerGroup');
		 * ```
		 */
		public offBatch(batchKey: string): void {
			if (typeof batchKey !== "string" || batchKey === "") {
				return;
			}
			for (const [type, callbacks] of this._eventMap.entries()) {
				const remaining = callbacks.filter(info => info.batchKey !== batchKey);
				if (remaining.length === 0) {
					this._eventMap.delete(type);
				} else {
					this._eventMap.set(type, remaining);
				}
			}
		}

		/**
		 * 移除事件监听（精确匹配）。
		 * - 若只提供 type 和 callback，则会移除该 type 下所有匹配 callback 的监听（无论 target 是什么）。
		 * - 若同时提供 target，则只会移除 callback 和 target 都匹配的监听。
		 * - 如果不传 callback，则会移除该 type 下的所有监听。
		 * @param type - 事件类型
		 * @param callback - 需要移除的回调函数（必须与注册时是同一个函数引用）
		 * @param target - 可选，绑定的 this 对象（必须与注册时完全一致，用于精确定位 否则可能不会移除）
		 * @example
		 * ```typescript
		 * // 移除特定回调（不限定 target）
		 * eventTarget.off('click', this.onClick);
		 * // 移除特定回调且指定 target
		 * eventTarget.off('click', this.onClick, this);
		 * // 移除整个类型的所有监听
		 * eventTarget.off('click');
		 * ```
		 */
		public off(type: string, callback?: (...args: any[]) => void, target?: any): void {
			const callbacks = this._eventMap.get(type);
			if (!callbacks) return;
			if (!callback) {
				this._eventMap.delete(type);
				return;
			}
			const remaining = callbacks.filter(info => {
				const isMatch = info.func === callback;
				const targetMatch = target === undefined || info.target === target;
				return !(isMatch && targetMatch);
			});
			if (remaining.length === 0) {
				this._eventMap.delete(type);
			} else {
				this._eventMap.set(type, remaining);
			}
		}

		/**
		 * 移除指定 target 下的所有事件监听。
		 * @param target - 目标对象（与注册时传入的 target 严格相等）
		 * @example
		 * ```typescript
		 * // 移除当前组件注册的所有事件
		 * eventTarget.targetOff(this);
		 * ```
		 */
		public targetOff(target: any): void {
			if (!target) return;
			for (const [type, callbacks] of this._eventMap.entries()) {
				const remaining = callbacks.filter(info => info.target !== target);
				if (remaining.length === 0) {
					this._eventMap.delete(type);
				} else {
					this._eventMap.set(type, remaining);
				}
			}
		}

		/**
		 * 派发事件，触发所有已注册的回调函数。
		 *
		 * @param type - 事件类型
		 * @param args - 传递给回调函数的参数（建议不超过 5 个，以保证性能）
		 * @example
		 * ```typescript
		 * // 无参数
		 * eventTarget.emit('start');
		 * // 推荐使用对象传参
		 * eventTarget.emit("update", { a: 1, b: 2 });
		 * // 带多个参数
		 * eventTarget.emit('scoreChanged', 100, 'level2');
		 * ```
		 */
		public emit(type: string, ...args: any[]): void {
			const callbacks = this._eventMap.get(type);
			if (!callbacks) return;
			const copy = [...callbacks];
			for (const info of copy) {
				if (typeof info.boundFunc !== "function") continue;
				if (info.once) {
					this.off(type, info.func, info.target);
				}
				try {
					info.boundFunc(...args);
				} catch (e) {
					console.error(`[EventListen] error in "${type}":`, e);
				}
			}
		}

		/**
		 * 移除所有事件监听。
		 * @example
		 * ```typescript
		 * eventTarget.removeAll();
		 * ```
		 */
		public removeAll(): void {
			this._eventMap.clear();
		}
	}

	/**
	 * 数据观察者类，基于 EventListen 实现对象属性的响应式监听。
	 * 当通过 set 修改属性值时，若新值与旧值不同，
	 * 则会自动触发对应属性的变更事件（changeKey:属性名）以及全局变更事件（changeAll）。
	 */
	export class Observer<T extends Record<string, any>> extends EventListen {
		/** 存储实际数据的对象 */
		private _data: T;

		/**
		 * 构造函数，接收初始数据对象。
		 * @param initialData - 初始数据，必须符合泛型 T 的结构
		 */
		constructor(initialData: T) {
			super();
			this._data = { ...initialData };
		}

		/**
		 * 获取指定 key 的值。
		 * @param key - 属性名（必须是 T 的键）
		 * @returns 对应的值
		 * @example
		 * state.get("count"); // 返回声明时的相应类型
		 */
		public get<K extends keyof T>(key: K): T[K] {
			return this._data[key];
		}

		/**
		 * 设置指定 key 的值。
		 * 若新值与旧值不同（使用 Object.is 比较），则触发：
		 * - 事件 `changeKey:属性名`，参数为 (newValue, oldValue, key)
		 * - 事件 `changeAll`，参数为 (完整数据, newValue, oldValue, key)
		 * @param key - 属性名
		 * @param value - 新值（类型需与 T[K] 匹配）
		 * @returns 是否成功修改（值发生变化时返回 true，否则 false）
		 */
		public set<K extends keyof T>(key: K, value: T[K]) {
			const oldValue = this._data[key];
			if (this.deepEqual(oldValue, value)) {
				return false;
			}
			this._data[key] = value;
			this.emit(`changeKey:${key as string}`, value, oldValue, key);
			this.emit("changeAll", this._data, value, oldValue, key);
			return true;
		}

		/**
		 * 监听指定属性的变化。
		 * 当该属性通过 set 方法修改且值发生变化时，注册的回调函数会被调用。
		 * @param key - 属性名
		 * @param callback - 回调函数，参数为 (newValue, oldValue, key)
		 * @param target - 可选，绑定的 this 对象（回调中的 this 将指向该对象）
		 * @example
		 * state.watch("user", (newUser, oldUser, key) => {
		 *     console.log(`用户信息已更新`, newUser);
		 * });
		 */
		public watch<K extends keyof T>(key: K, callback: (newValue: T[K], oldValue: T[K], key: K) => void, target?: any) {
			this.on(`changeKey:${key as string}`, callback, target);
		}

		/**
		 * 监听全部属性的变化（全局监听）。
		 * 当任意属性通过 set 方法修改且值发生变化时，注册的回调函数会被调用。
		 * @param callback - 回调函数，参数为 (更新后的完整数据, 被修改的属性名, 新值, 旧值)
		 * @param target - 可选，绑定的 this 对象
		 * @returns 回调标识（取决于底层 on 方法的返回值），可用于后续取消监听
		 * @example
		 * state.watchAll((newData, key, newVal, oldVal) => {
		 *     console.log(`属性 ${key} 由 ${oldVal} 变为 ${newVal}，当前数据：`, newData);
		 * });
		 */
		public watchAll(callback: (data: T, key: keyof T, newValue: any, oldValue: any) => void, target?: any) {
			return this.on("changeAll", callback, target);
		}

		/**
		 * 取消对指定属性的监听。
		 * @param key - 属性名
		 * @param callback - 回调函数（必须与 watch 时传入的是同一个函数引用）
		 * @param target - 可选，绑定的 this 对象（必须与 watch 时传入的一致，否则可能无法移除）
		 * @example
		 * state.unwatch("count", cb);
		 */
		public unwatch<K extends keyof T>(key: K, callback: (...args: any[]) => void, target?: any): void {
			this.off(`changeKey:${key as string}`, callback, target);
		}

		/*** 浅拷贝返回一个新对象，修改该拷贝不会影响原始数据 */
		public getAllData(): T {
			return { ...this._data };
		}

		/**
		 * 批量设置多个属性。
		 * 每个属性的 set 操作会独立触发各自的事件（changeKey 和 changeAll）。
		 * @param updates - 要更新的键值对对象（Partial<T>）
		 * @example
		 * state.setMultiple({ count: 100, flag: false });
		 */
		public setMultiple(updates: Partial<T>): void {
			for (const key in updates) {
				if (Object.prototype.hasOwnProperty.call(updates, key)) {
					this.set(key as keyof T, updates[key] as T[keyof T]);
				}
			}
		}

		/**
		 * 深度比较两个值是否相等
		 * @param a - 第一个值
		 * @param b - 第二个值
		 * @returns 是否深度相等
		 */
		deepEqual(a: T, b: T): boolean {
			// 如果类型不同，不相等
			if (typeof a !== typeof b) return false;
			// 处理严格相等（包括 NaN 等）
			if (Object.is(a, b)) return true;
			// 如果都不是对象或为 null，直接返回 false（因为 Object.is 已经处理过相等情况）
			if (a === null || b === null) return false;
			if (typeof a !== "object" || typeof b !== "object") return false;
			// 处理数组
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) return false;
				for (let i = 0; i < a.length; i++) {
					if (!this.deepEqual(a[i], b[i])) return false;
				}
				return true;
			}
			// 如果一个为数组一个不为数组，不相等
			if (Array.isArray(a) !== Array.isArray(b)) return false;
			// 处理普通对象
			const keysA = Object.keys(a);
			const keysB = Object.keys(b);
			if (keysA.length !== keysB.length) return false;
			for (const key of keysA) {
				if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
				if (!this.deepEqual(a[key], b[key])) return false;
			}
			return true;
		}
	}
	/**
	 * 类型安全的事件监听类
	 * @example
	 * interface GameEvents {
	 *   'scoreChange': (score: number) => void;
	 *   'gameOver': (reason: string) => void;
	 * }
	 * const bus = new TypedEventListen<GameEvents>();
	 * bus.emit('scoreChange', 100); // 类型安全
	 * bus.emit('gameOver', 'timeout'); // 类型安全
	 */
	export class TypedEventListen<T extends Record<keyof T, (...args: any[]) => any>> {
		private _bus = new EventListen();

		public on<K extends keyof T>(type: K, callback: T[K]): void {
			this._bus.on(type as string, callback as (...args: any[]) => void);
		}

		public once<K extends keyof T>(type: K, callback: T[K]): void {
			this._bus.once(type as string, callback as (...args: any[]) => void);
		}

		public off<K extends keyof T>(type: K, callback?: T[K]): void {
			this._bus.off(type as string, callback as any);
		}

		public emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void {
			this._bus.emit(type as string, ...args);
		}

		public removeAll() {
			this._bus.removeAll();
		}
	}
}

export default EventEmit;
