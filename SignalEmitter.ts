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
 * 基于 target + cb 唯一标识监听，支持按对象批量解绑、一次性监听
 * ⚠️局限性 回调函数不要绑定箭头函数 箭头函数的每次都是新的 无法去重
 *
 * @example
 * type AppSignals = {
 *     login: [userId: number, username: string];
 *     logout: [];
 *     resize: [width: number, height: number];
 * };
 *
 * const bus = new SignalEmitter<AppSignals>();
 *
 * // 注册常规监听
 * const unsub = bus.on("login", this, (uid, name) => {
 *     console.log(uid, name);
 * });
 * // 取消单次监听
 * unsub();
 *
 * // 一次性监听
 * bus.once("logout", this, () => location.reload());
 *
 * // 组件销毁批量解绑当前实例所有监听
 * bus.offAllByTarget(this);
 *
 * // 触发信号
 * bus.emit("login", 1001, "admin");
 */
export class SignalEmitter<T extends Record<string, any[]> = Record<string, any[]>> {
	/** 空无操作函数 */
	private static readonly NOOP = () => void 0;

	/** 信号名 -> 对应监听器集合 */
	private readonly signalMap = new Map<keyof T, Set<SignalData<any[]>>>();

	/**
	 * 内部统一注册监听逻辑
	 * @param signalKey 信号标识
	 * @param target 绑定对象
	 * @param cb 回调函数
	 * @param once 是否一次性监听
	 * @returns 取消订阅函数（幂等，多次调用无副作用）
	 */
	private bind<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void, once: boolean): () => void {
		// 参数强校验
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
		// 校验重复监听：同一target+同一cb不重复注册
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
	 * 注册常驻监听 ⚠️局限性 回调函数存在多次绑定的话 不要绑定箭头函数 箭头函数的每次都是新的 无法去重
	 * @param signalKey 信号名称
	 * @param target 绑定对象（用于批量解绑）
	 * @param cb 回调函数
	 * @returns 取消订阅函数
	 */
	public on<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void): () => void {
		return this.bind(signalKey, target, cb, false);
	}

	/**
	 * 注册一次性监听，触发一次后自动解绑 ⚠️局限性 回调函数不要绑定箭头函数 箭头函数的每次都是新的 无法去重
	 * @param signalKey 信号名称
	 * @param target 绑定对象
	 * @param cb 回调函数
	 * @returns 取消订阅函数
	 */
	public once<K extends keyof T>(signalKey: K, target: object, cb: (...args: T[K]) => void): () => void {
		return this.bind(signalKey, target, cb, true);
	}

	/**
	 * 移除指定信号下 target + cb 匹配的单个监听
	 * @param signalKey 信号名称
	 * @param target 绑定对象
	 * @param cb 注册时传入的回调函数
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
	 * @param target 绑定对象
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
	 * @param signalKey 信号名称
	 * @param args 信号携带参数
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
	 * @param signalKey 信号名称
	 */
	public has<K extends keyof T>(signalKey: K): boolean {
		return (this.signalMap.get(signalKey)?.size ?? 0) > 0;
	}

	/**
	 * 获取指定信号当前监听数量
	 * @param signalKey 信号名称
	 */
	public count<K extends keyof T>(signalKey: K): number {
		return this.signalMap.get(signalKey)?.size ?? 0;
	}

	/**
	 * 清空监听
	 * @param signalKey 传入信号名则仅清空该信号，不传则清空全部信号
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
	 */
	public destroy(): void {
		this.signalMap.clear();
	}
}
