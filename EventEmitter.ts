export namespace EventEmitter {
	/**
	 * 事件监听器信息（内部使用）
	 * @internal
	 */
	interface EventInfo {
		/** 原始回调函数 */
		func: (...args: any[]) => void;
		/** 绑定的 this 上下文对象 */
		target: any | undefined;
		/** 是否为一次性监听（触发后自动移除） */
		once: boolean;
		/** 绑定 this 后的最终执行函数（已通过 bind 绑定） */
		boundFunc: (...args: any[]) => void;
		/** 批量分组标识，用于 `offBatch` 批量取消 */
		batchKey: string;
	}

	/**
	 * 事件核心类
	 * @description 实现事件的订阅、发布、取消、批量管理等完整功能，所有事件回调均异步执行（微任务）。
	 *
	 * @example
	 * ```typescript
	 * const emitter = new EventEmitter.EventListen();
	 *
	 * // 订阅事件
	 * emitter.on ('greet', (name) => console.log(`Hello ${name}`));
	 *
	 * // 发布事件（异步触发）
	 * emitter.emit('greet', 'World');
	 *
	 * // 取消订阅
	 * emitter.off('greet');
	 * ```
	 */
	export class EventListen {
		/** 事件存储：key=事件名，value=监听器数组 */
		private _events = new Map<string, EventInfo[]>();
		/** 异步事件队列：用于微任务批量执行，key=事件名，value=参数数组的数组 */
		private _queue = new Map<string, any[][]>();
		/** 是否正在刷新队列，防止重复执行 */
		private _isFlushing = false;

		/**
		 * 订阅事件
		 * @param eventKey - 事件名称（非空字符串）
		 * @param callback - 事件回调函数
		 * @param target - 可选，回调函数中 `this` 指向的对象（自动绑定）
		 * @param batchKey - 可选，批量分组标识，用于 `offBatch` 批量取消
		 *
		 * @example
		 * ```typescript
		 * const obj = { name: 'Target' };
		 * emitter.on ('click', function() { console.log(this.name); }, obj); // this 指向 obj
		 * emitter.on ('data', (payload) => console.log(payload)); // 普通回调
		 * ```
		 */
		public on(eventKey: string, callback: (...args: any[]) => void, target?: any, batchKey = ""): void {
			if (!eventKey || typeof callback !== "function") {
				console.warn("[EventListen] 无效监听");
				return;
			}
			let list = this._events.get(eventKey);
			if (!list) {
				list = [];
				this._events.set(eventKey, list);
			}
			const exists = list.some(item => item.target === target && item.func === callback);
			if (exists) return;
			const boundFunc = target ? callback.bind(target) : callback;
			list.push({ func: callback, target: target, once: false, boundFunc, batchKey });
		}

		/**
		 * 订阅一次性事件（触发后自动取消）
		 * @param eventKey - 事件名称
		 * @param callback - 事件回调函数
		 * @param target - 可选，回调函数中 `this` 指向的对象
		 *
		 * @example
		 * ```typescript
		 * emitter.once('init', () => console.log('只执行一次'));
		 * emitter.emit('init'); // 输出
		 * emitter.emit('init'); // 无输出
		 * ```
		 */
		public once(eventKey: string, callback: (...args: any[]) => void, target?: any): void {
			if (!eventKey || typeof callback !== "function") return;
			let list = this._events.get(eventKey);
			if (!list) {
				list = [];
				this._events.set(eventKey, list);
			}
			const boundFunc = target ? callback.bind(target) : callback;
			list.push({ func: callback, target: target, once: true, boundFunc, batchKey: "" });
		}

		/**
		 * 批量订阅事件（统一分组）
		 * @param batchKey - 分组标识（非空字符串），用于后续 `offBatch` 批量取消
		 * @param events - 事件配置数组，每个元素包含 `eventKey`、`callback`、`target`（可选）
		 *
		 * @example
		 * ```typescript
		 * emitter.onBatch('playerGroup', [
		 *   { eventKey: 'levelUp', callback: this.onLevelUp, target: this },
		 *   { eventKey: 'death', callback: this.onDeath, target: this }
		 * ]);
		 * ```
		 */
		public onBatch(batchKey: string, events: { eventKey: string; callback: (...args: any[]) => void; target: any }[]): void {
			if (!batchKey) return;
			for (const event of events) this.on(event.eventKey, event.callback, event.target, batchKey);
		}

		/**
		 * 取消指定分组的所有事件
		 * @param batchKey - 分组标识（与 `onBatch` 时传入的相同）
		 *
		 * @example
		 * ```typescript
		 * emitter.offBatch('playerGroup'); // 移除 playerGroup 分组下注册的所有事件
		 * ```
		 */
		public offBatch(batchKey: string): void {
			if (!batchKey) return;
			for (const [eventKey, list] of this._events) {
				const filtered = list.filter(item => item.batchKey !== batchKey);
				filtered.length ? this._events.set(eventKey, filtered) : this._events.delete(eventKey);
			}
		}

		/**
		 * 取消事件订阅
		 * @param eventKey - 事件名称
		 * @param callback - 可选，要取消的回调函数。若不传则移除该事件类型下的所有监听
		 * @param target - 可选，绑定的 `this` 对象（必须与注册时完全一致，用于精确定位）
		 *
		 * @example
		 * ```typescript
		 * // 移除特定回调（不限定 context）
		 * emitter.off('click', onClick);
		 * // 移除特定回调且指定 target
		 * emitter.off('click', onClick, this);
		 * // 移除整个事件类型的所有监听
		 * emitter.off('click');
		 * ```
		 */
		public off(eventKey: string, callback?: (...args: any[]) => void, target?: any): void {
			const list = this._events.get(eventKey);
			if (!list) return;
			if (!callback) {
				this._events.delete(eventKey);
				return;
			}
			const filtered = list.filter(item => {
				if (item.func !== callback) return true;
				if (target !== undefined && item.target !== target) return true;
				return false;
			});
			filtered.length ? this._events.set(eventKey, filtered) : this._events.delete(eventKey);
		}

		/**
		 * 取消指定上下文绑定的所有事件
		 * @param target - 目标对象（与注册时传入的 `target` 严格相等）
		 *
		 * @example
		 * ```typescript
		 * emitter.targetOff(this); // 移除当前组件注册的所有事件
		 * ```
		 */
		public targetOff(target: any): void {
			if (!target) return;
			for (const [eventKey, list] of this._events) {
				const filtered = list.filter(item => item.target !== target);
				filtered.length ? this._events.set(eventKey, filtered) : this._events.delete(eventKey);
			}
		}

		/**
		 * 判断某个事件是否存在监听器
		 * @param eventKey - 事件名称
		 * @returns 是否存在至少一个监听器
		 *
		 * @example
		 * ```typescript
		 * if (emitter.hasListeners('update')) {
		 *   emitter.emit('update', data);
		 * }
		 * ```
		 */
		public hasListeners(eventKey: string): boolean {
			const list = this._events.get(eventKey);
			return !!list?.length;
		}

		/**
		 * 发布事件（异步执行，微任务）
		 * @param eventKey - 事件名称
		 * @param args - 传递给回调函数的参数（可变参数）
		 *
		 * @example
		 * ```typescript
		 * // 无参数
		 * emitter.emit('start');
		 * // 单个参数
		 * emitter.emit('score', 100);
		 * // 多个参数
		 * emitter.emit('change', 'name', '张三', '李四');
		 * ```
		 */
		public emit(eventKey: string, ...args: any[]): void {
			const list = this._events.get(eventKey);
			if (!list?.length) return;
			const queue = this._queue.get(eventKey) || [];
			queue.push(args);
			this._queue.set(eventKey, queue);
			if (!this._isFlushing) {
				this._isFlushing = true;
				Promise.resolve().then(() => this._trigger());
			}
		}

		/**
		 * 刷新事件队列，批量执行所有事件回调
		 * @internal
		 */
		private _trigger(): void {
			const queues = this._queue;
			this._queue = new Map();
			const toRemove = new Set<EventInfo>();
			for (const [eventKey, argsList] of queues) {
				const list = this._events.get(eventKey);
				if (!list?.length) continue;
				const snapshot = list;
				for (const args of argsList) {
					for (const info of snapshot) {
						if (toRemove.has(info)) continue;
						try {
							info.boundFunc(...args);
							if (info.once) toRemove.add(info);
						} catch (error) {
							console.error(`事件:${eventKey},触发错误:`, error);
						}
					}
				}
			}
			for (const [eventKey, list] of this._events) {
				const filtered = list.filter(item => !toRemove.has(item));
				filtered.length ? this._events.set(eventKey, filtered) : this._events.delete(eventKey);
			}
			this._isFlushing = false;
			if (this._queue.size > 0) {
				this._isFlushing = true;
				Promise.resolve().then(() => this._trigger());
			}
		}

		/**
		 * 清空所有事件与队列
		 * @example
		 * ```typescript
		 * emitter.clear(); // 移除所有监听器，清空待执行队列
		 * ```
		 */
		public clear(): void {
			this._events.clear();
			this._queue.clear();
			this._isFlushing = false;
		}

		/**
		 * 获取所有监听器信息（用于调试）
		 * @returns 只读的事件监听器快照，结构为 `{ [eventKey]: Array<{ func, target, once }> }`
		 *
		 * @example
		 * ```typescript
		 * console.log(emitter.getAllListeners());
		 * // 输出: { click: [{ func: Function, target: obj, once: false }] }
		 * ```
		 */
		public getAllListeners(): Readonly<Record<string, readonly { func: Function; target: any; once: boolean }[]>> {
			const result: Record<string, any[]> = {};
			for (const [eventKey, list] of this._events) {
				result[eventKey] = list.map(item => ({ func: item.func, target: item.target, once: item.once }));
			}
			return result;
		}
	}

	/**
	 * 响应式数据观察者
	 * @description 基于事件系统实现的数据响应式，支持监听属性变化。当通过 `set` 修改属性时，若存在对应监听器，会触发 `changeKey_属性名` 和 `changeAll` 事件。
	 *
	 * @remarks 注意：仅当属性对应的事件存在监听器时，数据才会被实际修改。这意味着若无任何监听，`set` 将无效。
	 *
	 * @example
	 * ```typescript
	 * const state = new EventEmitter.Observer({ count: 0, user: { name: 'Alice' } });
	 *
	 * // 监听单个属性
	 * state.watch('count', (newVal, oldVal, key) => {
	 *   console.log(`${key} 从 ${oldVal} 变为 ${newVal}`);
	 * });
	 *
	 * // 监听所有属性
	 * state.watchAll((fullData, newVal, oldVal, key) => {
	 *   console.log('数据已更新', fullData);
	 * });
	 *
	 * state.set('count', 10); // 触发 watch 和 watchAll
	 * ```
	 */
	export class Observer<T extends Record<string, any>> extends EventListen {
		/** 内部存储的真实数据 */
		private _data: T;

		/**
		 * 创建响应式数据实例
		 * @param initialData - 初始数据对象，会被深拷贝存储
		 */
		constructor(initialData: T) {
			super();
			this._data = this._deepCopy(initialData);
		}

		/**
		 * 深拷贝（支持对象/数组/Date/Map/Set）
		 * @param value - 要拷贝的值
		 * @returns 深拷贝后的值
		 * @internal
		 */
		private _deepCopy<U>(value: U): U {
			if (value === null || typeof value !== "object") return value;
			if (value instanceof Date) return new Date(value) as U;
			if (value instanceof Map) return new Map(value) as U;
			if (value instanceof Set) return new Set(value) as U;
			if (Array.isArray(value)) return [...value] as unknown as U;
			return { ...value } as U;
		}

		/**
		 * 获取指定属性的值（返回深拷贝，防止外部篡改）
		 * @param key - 属性名
		 * @returns 对应值的深拷贝副本
		 *
		 * @example
		 * ```typescript
		 * const count = state.get('count'); // 返回副本，修改不影响原数据
		 * ```
		 */
		public getValueByKey<K extends keyof T>(eventKey: K): T[K] {
			return this._deepCopy(this._data[eventKey]);
		}

		/**
		 * 获取完整数据（深拷贝）
		 * @returns 完整数据的深拷贝副本
		 *
		 * @example
		 * ```typescript
		 * const snapshot = state.getAllData();
		 * ```
		 */
		public getAllData(): T {
			return this._deepCopy(this._data);
		}

		/**
		 * 设置数据（自动触发监听）
		 * @param key - 键名
		 * @param value - 新值
		 * @param forceEmit - 是否强制触发更新，无视值是否相等（默认 false）
		 *
		 * @remarks 只有当对应的 `changeKey_${key}` 事件存在监听器时，才会实际修改数据并触发事件。否则调用无效。
		 *
		 * @example
		 * ```typescript
		 * state.set('count', 100);          // 值不同时触发事件
		 * state.set('count', 100, true);    // 强制触发事件（即使值相同）
		 * ```
		 */
		public updateValueByKey<K extends keyof T>(eventKey: K, value: T[K], forceEmit = false): void {
			const oldValue = this._data[eventKey];
			const isEqual = typeof value === "object" ? this._deepEqual(oldValue, value) : Object.is(oldValue, value);
			if (!forceEmit && isEqual) return;
			const _eventKey = `changeKey_${String(eventKey)}`;
			if (this.hasListeners(_eventKey)) {
				this._data[eventKey] = value;
				this.emit(_eventKey, value, oldValue, eventKey);
				this.emit("changeAll", this._deepCopy(this._data), value, oldValue, eventKey);
			}
		}

		/**
		 * 批量设置数据
		 * @param data - 部分数据对象，会依次调用 `set`
		 *
		 * @example
		 * ```typescript
		 * state.setMultiple({ count: 10, user: { name: 'Bob' } });
		 * ```
		 */
		public setMultiple(data: Partial<T>) {
			for (const key in data) {
				if (Object.prototype.hasOwnProperty.call(data, key)) {
					this.updateValueByKey(key as keyof T, data[key]!);
				}
			}
		}

		/**
		 * 深度比较两个值是否相等
		 * @param a - 比较值 A
		 * @param b - 比较值 B
		 * @param depth - 当前递归深度（默认0，最大5层）
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
			if (a instanceof Date) return a.getTime() === b.getTime();
			if (a instanceof RegExp) return a.toString() === b.toString();
			if (a instanceof Map) {
				if (a.size !== b.size) return false;
				for (const [key, val] of a) if (!this._deepEqual(val, b.get(key), depth + 1)) return false;
				return true;
			}
			if (a instanceof Set) {
				return this._deepEqual([...a].sort(), [...b].sort(), depth + 1);
			}
			const keysA = Object.keys(a);
			const keysB = Object.keys(b);
			if (keysA.length !== keysB.length) return false;
			for (const key of keysA) if (!this._deepEqual(a[key], b[key], depth + 1)) return false;
			return true;
		}

		/**
		 * 监听单个属性变化
		 * @param key - 监听的属性名
		 * @param callback - 回调函数，参数为 `(newValue, oldValue, key)`
		 * @param target - 可选，回调中 `this` 指向的对象
		 *
		 * @example
		 * ```typescript
		 * state.watch('count', (newVal, oldVal, key) => {
		 *   console.log(`${key} changed: ${oldVal} -> ${newVal}`);
		 * });
		 * ```
		 */
		public watchBykey<K extends keyof T>(eventKey: K, callback: (newValue: T[K], oldValue: T[K], changedKey: K) => void, target?: any) {
			this.on(`changeKey_${String(eventKey)}`, callback, target);
		}

		/**
		 * 监听所有属性变化
		 * @param callback - 回调函数，参数为 `(fullData, newValue, oldValue, changedKey)`
		 * @param target - 可选，回调中 `this` 指向的对象
		 *
		 * @example
		 * ```typescript
		 * state.watchAll((fullData, newVal, oldVal, key) => {
		 *   console.log(`属性 ${key} 由 ${oldVal} 变为 ${newVal}，当前数据：`, fullData);
		 * });
		 * ```
		 */
		public watchAll(callback: (fullData: T, newValue: any, oldValue: any, changedKey: keyof T) => void, target?: any) {
			this.on("changeAll", callback, target);
		}

		/**
		 * 取消单个属性监听
		 * @param key - 属性名
		 * @param callback - 回调函数（必须与 `watch` 时传入的同一个函数引用）
		 * @param target - 可选，绑定的 `this` 对象（必须与 `watch` 时一致）
		 *
		 * @example
		 * ```typescript
		 * const handler = (newVal, oldVal, key) => { ... };
		 * state.watch('count', handler);
		 * // ... 之后取消
		 * state.unwatch('count', handler);
		 * ```
		 */
		public unwatch<K extends keyof T>(eventKey: K, callback: (newValue: T[K], oldValue: T[K], eventKey: K) => void, target?: any) {
			this.off(`changeKey_${String(eventKey)}`, callback, target);
		}
	}

	/**
	 * 类型安全的事件总线
	 * @description 基于泛型提供事件名、回调参数的智能提示与类型校验。包装内部 `EventListen` 实例，对外提供强类型 API。
	 *
	 * @example
	 * ```typescript
	 * interface MyEvents {
	 *   'click': (x: number, y: number) => void;
	 *   'loaded': (data: string) => void;
	 * }
	 *
	 * const bus = new EventEmitter.TypedEventListen<MyEvents>();
	 *
	 * // 参数自动推导
	 * bus.on ('click', (x, y) => console.log(x + y));
	 * bus.emit('click', 10, 20);
	 * // bus.emit('click', 'a'); // 类型错误
	 * ```
	 */
	export class TypedEventListen<T> {
		/** 内部非类型安全的事件总线实例 */
		private _eventBus = new EventListen();

		/**
		 * 类型安全订阅事件
		 * @param eventKey - 事件名（自动提示）
		 * @param callback - 回调函数（参数自动推导）
		 * @param target - 可选，回调中 `this` 指向的对象
		 *
		 * @example
		 * ```typescript
		 * bus.on ('loaded', (data) => { console.log(data.length); });
		 * ```
		 */
		public on<K extends keyof T>(eventKey: K, callback: T[K] extends (...args: any[]) => void ? T[K] : never, target?: any): void {
			this._eventBus.on(eventKey as string, callback as any, target);
		}

		/**
		 * 类型安全一次性订阅
		 * @param eventKey - 事件名
		 * @param callback - 回调函数（参数自动推导）
		 * @param target - 可选，回调中 `this` 指向的对象
		 */
		public once<K extends keyof T>(eventKey: K, callback: T[K] extends (...args: any[]) => void ? T[K] : never, target?: any): void {
			this._eventBus.once(eventKey as string, callback as any, target);
		}

		/**
		 * 类型安全取消订阅
		 * @param eventKey - 事件名
		 * @param callback - 可选，要取消的回调函数
		 * @param target - 可选，绑定的 `this` 对象
		 */
		public off<K extends keyof T>(eventKey: K, callback?: T[K] extends (...args: any[]) => void ? T[K] : never, target?: any): void {
			this._eventBus.off(eventKey as string, callback as any, target);
		}

		/**
		 * 类型安全发布事件
		 * @param eventKey - 事件名
		 * @param args - 参数列表（自动校验类型）
		 *
		 * @example
		 * ```typescript
		 * bus.emit('click', 100, 200);
		 * ```
		 */
		public emit<K extends keyof T>(eventKey: K, ...args: T[K] extends (...args: any[]) => void ? Parameters<T[K]> : never[]): void {
			this._eventBus.emit(eventKey as string, ...args);
		}

		/**
		 * 类型安全批量订阅
		 * @param batchKey - 分组标识
		 * @param events - 事件列表，每个元素包含 `eventKey`、`callback`、`target`（可选）
		 *
		 * @example
		 * ```typescript
		 * bus.onBatch('playerGroup', [
		 *   { eventKey: 'levelUp', callback: this.onLevelUp, target: this },
		 *   { eventKey: 'death', callback: this.onDeath, target: this }
		 * ]);
		 * ```
		 */
		public listens<K extends keyof T>(batchKey: string, events: Array<{ eventKey: K; callback: T[K] extends (...args: any[]) => void ? T[K] : never; target?: any }>) {
			this._eventBus.onBatch(batchKey, events as any);
		}

		/**
		 * 取消批量订阅
		 * @param batchKey - 分组标识
		 */
		public offBatch(batchKey: string): void {
			this._eventBus.offBatch(batchKey);
		}

		/**
		 * 取消指定上下文的所有监听
		 * @param target - 目标对象
		 */
		public targetOff(target: any): void {
			this._eventBus.targetOff(target);
		}

		/**
		 * 清空所有事件
		 */
		public clear(): void {
			this._eventBus.clear();
		}

		/**
		 * 是否存在监听器
		 * @param eventKey - 事件名
		 * @returns 是否存在至少一个监听器
		 */
		public hasListeners(eventKey: string): boolean {
			return this._eventBus.hasListeners(eventKey);
		}

		/**
		 * 获取所有监听器（调试用）
		 * @returns 监听器快照（只读）
		 */
		public getAllListeners() {
			return this._eventBus.getAllListeners();
		}
	}
}

export default EventEmitter;
