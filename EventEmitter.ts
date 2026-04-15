export namespace EventEmitter {
	/**
	 * 事件监听器信息
	 * @internal 内部使用
	 */
	interface EventInfo {
		/** 原始回调函数 */
		func: (...args: any[]) => void;
		/** 绑定的 this 上下文 */
		target: any | undefined;
		/** 是否为一次性监听 */
		once: boolean;
		/** 绑定 this 后的最终执行函数 */
		boundFunc: (...args: any[]) => void;
		/** 批量分组 key，用于批量取消 */
		batchKey: string;
	}

	/**
	 * 事件核心类
	 * @description 实现事件的订阅、发布、取消、批量管理等完整功能
	 */
	export class EventListen {
		/** 事件存储：key=事件名，value=监听器数组 */
		private _events = new Map<string, EventInfo[]>();
		/** 异步事件队列：用于微任务批量执行 */
		private _queue = new Map<string, any[][]>();
		/** 是否正在刷新队列，防止重复执行 */
		private _isFlushing = false;

		/**
		 * 订阅事件
		 * @param type 事件名称
		 * @param callback 事件回调
		 * @param target 回调绑定的 this
		 * @param batchKey 批量分组key，用于批量取消
		 */
		public on(type: string, callback: (...args: any[]) => void, target?: any, batchKey = ""): void {
			if (!type || typeof callback !== "function") {
				console.warn("[EventListen] 无效监听");
				return;
			}
			let list = this._events.get(type);
			if (!list) {
				list = [];
				this._events.set(type, list);
			}
			const exists = list.some(it => it.target === target && it.func === callback);
			if (exists) return;
			const boundFunc = target ? callback.bind(target) : callback;
			list.push({ func: callback, target, once: false, boundFunc, batchKey });
		}

		/**
		 * 订阅一次性事件（触发后自动取消）
		 * @param type 事件名称
		 * @param callback 事件回调
		 * @param target 回调绑定的 this
		 */
		public once(type: string, callback: (...args: any[]) => void, target?: any): void {
			if (!type || typeof callback !== "function") return;
			let list = this._events.get(type);
			if (!list) {
				list = [];
				this._events.set(type, list);
			}
			const boundFunc = target ? callback.bind(target) : callback;
			list.push({ func: callback, target, once: true, boundFunc, batchKey: "" });
		}

		/**
		 * 批量订阅事件（统一分组）
		 * @param batchKey 分组标识
		 * @param events 事件列表
		 */
		public onBatch(batchKey: string, events: { type: string; callback: (...args: any[]) => void; target: any }[]): void {
			if (!batchKey) return;
			for (const ev of events) this.on(ev.type, ev.callback, ev.target, batchKey);
		}

		/**
		 * 取消指定分组的所有事件
		 * @param batchKey 分组标识
		 */
		public offBatch(batchKey: string): void {
			if (!batchKey) return;
			for (const [type, list] of this._events) {
				const filtered = list.filter(it => it.batchKey !== batchKey);
				filtered.length ? this._events.set(type, filtered) : this._events.delete(type);
			}
		}

		/**
		 * 取消事件订阅
		 * @param type 事件名称
		 * @param callback 要取消的回调
		 * @param target 绑定的this
		 */
		public off(type: string, callback?: (...args: any[]) => void, target?: any): void {
			const list = this._events.get(type);
			if (!list) return;
			if (!callback) {
				this._events.delete(type);
				return;
			}
			const filtered = list.filter(it => {
				if (it.func !== callback) return true;
				if (target !== undefined && it.target !== target) return true;
				return false;
			});
			filtered.length ? this._events.set(type, filtered) : this._events.delete(type);
		}

		/**
		 * 取消指定 target 绑定的所有事件
		 * @param target 目标对象
		 */
		public targetOff(target: any): void {
			if (!target) return;
			for (const [type, list] of this._events) {
				const filtered = list.filter(it => it.target !== target);
				filtered.length ? this._events.set(type, filtered) : this._events.delete(type);
			}
		}

		/**
		 * 判断某个事件是否存在监听器
		 * @param type 事件名称
		 * @returns boolean
		 */
		public hasListeners(type: string): boolean {
			const list = this._events.get(type);
			return !!list?.length;
		}

		/**
		 * 发布事件（异步执行，微任务）
		 * @param type 事件名称
		 * @param args 传递的参数
		 */
		public emit(type: string, ...args: any[]): void {
			const list = this._events.get(type);
			if (!list?.length) return;
			const queue = this._queue.get(type) || [];
			queue.push(args);
			this._queue.set(type, queue);
			if (!this._isFlushing) {
				this._isFlushing = true;
				Promise.resolve().then(() => this._flush());
			}
		}

		/**
		 * 刷新事件队列，批量执行所有事件回调
		 * @internal
		 */
		private _flush(): void {
			const queues = this._queue;
			this._queue = new Map();
			const toRemove = new Set<EventInfo>();
			for (const [type, argsList] of queues) {
				const list = this._events.get(type);
				if (!list?.length) continue;
				const snapshot = list;
				for (const args of argsList) {
					for (const info of snapshot) {
						if (toRemove.has(info)) continue;
						try {
							info.boundFunc(...args);
							if (info.once) toRemove.add(info);
						} catch (e) {
							console.error(`事件:${type},触发错误:`, e);
						}
					}
				}
			}
			for (const [type, list] of this._events) {
				const filtered = list.filter(it => !toRemove.has(it));
				filtered.length ? this._events.set(type, filtered) : this._events.delete(type);
			}
			this._isFlushing = false;
			if (this._queue.size > 0) {
				this._isFlushing = true;
				Promise.resolve().then(() => this._flush());
			}
		}

		/** 清空所有事件与队列 */
		public removeAll(): void {
			this._events.clear();
			this._queue.clear();
		}

		/**
		 * 获取所有监听器信息（用于调试）
		 * @returns 只读的事件监听器快照
		 */
		public getAllListeners(): Readonly<Record<string, readonly { func: Function; target: any; once: boolean }[]>> {
			const result: Record<string, any[]> = {};
			for (const [type, list] of this._events) {
				result[type] = list.map(it => ({ func: it.func, target: it.target, once: it.once }));
			}
			return result;
		}
	}

	/**
	 * 响应式数据观察者
	 * @description 基于事件系统实现的数据响应式，支持监听属性变化
	 */
	export class Observer<T extends Record<string, any>> extends EventListen {
		/** 内部存储的真实数据 */
		private _data: T;

		/**
		 * 创建响应式数据
		 * @param initial 初始数据
		 */
		constructor(initial: T) {
			super();
			this._data = this._deepCopy(initial);
		}

		/**
		 * 深拷贝（支持对象/数组/Date/Map/Set）
		 * @param val 要拷贝的值
		 * @returns 深拷贝后的值
		 */
		private _deepCopy<U>(val: U): U {
			if (val === null || typeof val !== "object") return val;
			if (val instanceof Date) return new Date(val) as U;
			if (val instanceof Map) return new Map(val) as U;
			if (val instanceof Set) return new Set(val) as U;
			if (Array.isArray(val)) return [...val] as unknown as U;
			return { ...val } as U;
		}

		/**
		 * 获取数据（返回深拷贝，防止外部篡改）
		 * @param k 键名
		 * @returns 对应值
		 */
		public get<K extends keyof T>(k: K): T[K] {
			return this._deepCopy(this._data[k]);
		}

		/**
		 * 获取完整数据（深拷贝）
		 * @returns 完整数据
		 */
		public getAllData(): T {
			return this._deepCopy(this._data);
		}

		/**
		 * 设置数据（自动触发监听）
		 * @param key 键名
		 * @param value 新值
		 * @param forceEmit 是否强制触发更新，无视值是否相等
		 */
		public set<K extends keyof T>(key: K, value: T[K], forceEmit = false): void {
			const oldValue = this._data[key];
			const isEqual = typeof value === "object" ? this._deepEqual(oldValue, value) : Object.is(oldValue, value);
			if (!forceEmit && isEqual) return;
			const eventKey = `changeKey_${String(key)}`;
			if (this.hasListeners(eventKey)) {
				this._data[key] = value;
				this.emit(eventKey, key, value, oldValue);
				this.emit("changeAll", key, value, oldValue, this._data);
			}
		}

		/**
		 * 批量设置数据
		 * @param data 部分数据
		 */
		public setMultiple(data: Partial<T>) {
			for (const k in data) {
				if (Object.prototype.hasOwnProperty.call(data, k)) {
					this.set(k as keyof T, data[k]!);
				}
			}
		}

		/**
		 * 深度比较两个值是否相等
		 * @param a 比较值A
		 * @param b 比较值B
		 * @param d 当前递归深度
		 * @returns 是否相等
		 */
		private _deepEqual(a: any, b: any, d = 0): boolean {
			const MAX = 5;
			if (d > MAX) return Object.is(a, b);
			if (Object.is(a, b)) return true;
			if (!a || !b) return !a && !b;
			if (typeof a !== "object" || typeof b !== "object") return false;
			if (a.constructor !== b.constructor) return false;
			if (a instanceof Date) return a.getTime() === b.getTime();
			if (a instanceof RegExp) return a.toString() === b.toString();

			if (a instanceof Map) {
				if (a.size !== b.size) return false;
				for (const [k, v] of a) if (!this._deepEqual(v, b.get(k), d + 1)) return false;
				return true;
			}

			if (a instanceof Set) {
				return this._deepEqual([...a].sort(), [...b].sort(), d + 1);
			}

			const ka = Object.keys(a);
			const kb = Object.keys(b);
			if (ka.length !== kb.length) return false;
			for (const k of ka) if (!this._deepEqual(a[k], b[k], d + 1)) return false;
			return true;
		}

		/**
		 * 监听单个属性变化
		 * @param key 监听的属性名
		 * @param cb 回调：key, newValue, oldValue
		 * @param t 绑定this
		 */
		public watch<K extends keyof T>(key: K, cb: (key: K, newValue: T[K], oldValue: T[K]) => void, t?: any) {
			this.on(`changeKey_${String(key)}`, cb, t);
		}

		/**
		 * 监听所有属性变化
		 * @param cb 回调：key, newValue, oldValue, fullData
		 * @param t 绑定this
		 */
		public watchAll(cb: (key: keyof T, newValue: any, oldValue: any, fullData: T) => void, t?: any) {
			this.on("changeAll", cb, t);
		}

		/**
		 * 取消单个属性监听
		 * @param key 属性名
		 * @param cb 回调
		 * @param t 绑定this
		 */
		public unwatch<K extends keyof T>(key: K, cb: (key: K, newValue: T[K], oldValue: T[K]) => void, t?: any) {
			this.off(`changeKey_${String(key)}`, cb, t);
		}
	}

	/**
	 * 类型安全的事件总线
	 * @description 基于泛型提供事件名、回调参数的智能提示与类型校验
	 */
	export class TypedEventListen<T> {
		/** 内部事件总线实例 */
		private _eventBus = new EventListen();

		/**
		 * 类型安全订阅事件
		 * @param type 事件名（自动提示）
		 * @param callback 回调（参数自动推导）
		 * @param target 绑定this
		 */
		public on<K extends keyof T>(type: K, callback: T[K] extends (...args: any[]) => void ? T[K] : never, target?: any): void {
			this._eventBus.on(type as string, callback as any, target);
		}

		/**
		 * 类型安全一次性订阅
		 * @param type 事件名
		 * @param callback 回调
		 * @param target 绑定this
		 */
		public once<K extends keyof T>(type: K, callback: T[K] extends (...args: any[]) => void ? T[K] : never, target?: any): void {
			this._eventBus.once(type as string, callback as any, target);
		}

		/**
		 * 类型安全取消订阅
		 * @param type 事件名
		 * @param callback 回调
		 * @param target 绑定this
		 */
		public off<K extends keyof T>(type: K, callback?: T[K] extends (...args: any[]) => void ? T[K] : never, target?: any): void {
			this._eventBus.off(type as string, callback as any, target);
		}

		/**
		 * 类型安全发布事件
		 * @param type 事件名
		 * @param args 参数（自动校验类型）
		 */
		public emit<K extends keyof T>(type: K, ...args: T[K] extends (...args: any[]) => void ? Parameters<T[K]> : never[]): void {
			this._eventBus.emit(type as string, ...args);
		}

		/**
		 * 类型安全批量订阅
		 * @param batchKey 分组key
		 * @param events 事件列表（type自动提示）
		 */
		public onBatch<K extends keyof T>(batchKey: string, events: Array<{ type: K; callback: T[K] extends (...args: any[]) => void ? T[K] : never; target?: any }>) {
			this._eventBus.onBatch(batchKey, events as any);
		}

		/**
		 * 取消批量订阅
		 * @param batchKey 分组key
		 */
		public offBatch(batchKey: string): void {
			this._eventBus.offBatch(batchKey);
		}

		/**
		 * 取消指定target的所有监听
		 * @param target 目标对象
		 */
		public targetOff(target: any): void {
			this._eventBus.targetOff(target);
		}

		/** 清空所有事件 */
		public removeAll(): void {
			this._eventBus.removeAll();
		}

		/**
		 * 是否存在监听
		 * @param type 事件名
		 * @returns boolean
		 */
		public hasListeners(type: string): boolean {
			return this._eventBus.hasListeners(type);
		}

		/**
		 * 获取所有监听器（调试用）
		 * @returns 监听器快照
		 */
		public getAllListeners() {
			return this._eventBus.getAllListeners();
		}
	}
}

export default EventEmitter;
