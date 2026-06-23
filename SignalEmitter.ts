/**
 * 原生弱引用类型声明（环境无内置WeakRef时兼容补齐）
 */
interface WeakRef<T extends object> {
	/**
	 * 获取弱引用绑定的原始对象
	 * @returns 对象存在返回实例，已被GC回收返回 undefined
	 */
	deref(): T | undefined;
}

interface WeakRefConstructor {
	readonly prototype: WeakRef<object>;
	/**
	 * 创建对象弱引用
	 * @param target 仅支持 object 类型，基础类型无法弱引用
	 */
	new <T extends object>(target: T): WeakRef<T>;
}

declare var WeakRef: WeakRefConstructor;

/**
 * 单条监听存储单元
 * @template TArgs 当前信号对应的参数元组类型
 */
interface SignalData<TArgs extends any[]> {
	/** 信号触发回调函数 */
	cb: (...args: TArgs) => void;
	/** 监听上下文弱引用，不阻碍GC回收目标对象 */
	targetRef: WeakRef<object>;
	/** 是否一次性监听：true 触发一次自动解绑 */
	once: boolean;
}

/**
 * 强类型信号发射器
 * @template T 信号映射表 Record<信号名, 参数元组>
 * @example
 * type AppSignals = {
 *   login: [number, string],
 *   logout: [],
 *   resize: [number, number]
 * };
 * const signalBus = new SignalEmitter<AppSignals>();
 */
export class SignalEmitter<T extends Record<string, any[]> = Record<string, any[]>> {
	/** 信号存储池 Map<信号名, 当前信号全部监听集合> */
	private readonly _signalMap = new Map<keyof T, Set<SignalData<any[]>>>();

	/**
	 * 注册/初始化信号容器
	 * 不存在该信号则创建空监听集合，已存在无操作
	 * @param signalKey 信号唯一标识
	 * @throws {Error} signalKey 为空直接抛出异常
	 */
	protected create<K extends keyof T>(signalKey: K): void {
		if (!signalKey) throw new Error(`信号Key不能为空`);
		if (!this._signalMap.has(signalKey)) {
			this._signalMap.set(signalKey, new Set());
		}
	}

	/**
	 * 内部统一绑定逻辑（on / once 复用）
	 * @param signalKey 信号标识
	 * @param cb 回调函数
	 * @param target 上下文对象
	 * @param once 是否一次性监听
	 * @returns 解绑函数
	 */
	private onBind<K extends keyof T>(signalKey: K, cb: (...args: T[K]) => void, target: object, once: boolean = false): () => void {
		this.create(signalKey);
		const listenerSet = this._signalMap.get(signalKey)!;
		const has = Array.from(listenerSet).some(item => {
			const ctx = item.targetRef.deref();
			return ctx === target && item.cb === cb;
		});
		if (has) {
			console.warn(`信号[${String(signalKey)}]重复绑定相同监听，已跳过`);
			return () => void 0;
		}
		listenerSet.add({ cb, targetRef: new WeakRef(target), once });
		return () => this.off(signalKey, cb, target);
	}

	/**
	 * 持续监听信号（多次触发）
	 * @param signalKey 目标信号名称
	 * @param cb 信号回调函数，参数与泛型定义严格匹配 不要绑定监听函数 监听函数存在无法去重
	 * @param target 回调this上下文，默认当前SignalEmitter实例
	 * @returns 解绑函数，调用即可移除本次监听
	 */
	on<K extends keyof T>(signalKey: K, cb: (...args: T[K]) => void, target: object = this): () => void {
		return this.onBind(signalKey, cb, target);
	}

	/**
	 * 一次性监听信号，触发一次自动销毁
	 * @param signalKey 目标信号名称
	 * @param cb 信号回调函数 不要绑定监听函数  监听函数存在无法去重
	 * @param target 回调this上下文，默认当前实例
	 * @returns 解绑函数，可提前手动取消监听
	 */
	once<K extends keyof T>(signalKey: K, cb: (...args: T[K]) => void, target: object = this): () => void {
		return this.onBind(signalKey, cb, target, true);
	}

	/**
	 * 手动移除单条监听
	 * 根据回调函数+上下文对象精准匹配删除
	 * @param signalKey 目标信号名称
	 * @param cb 绑定的回调函数引用
	 * @param target 绑定的上下文对象，默认当前实例
	 */
	off<K extends keyof T>(signalKey: K, cb: (...args: T[K]) => void, target: object = this): void {
		const listenerSet = this._signalMap.get(signalKey);
		if (!listenerSet) return;
		const snapshot = Array.from(listenerSet);
		for (const item of snapshot) {
			const ctx = item.targetRef.deref();
			if (ctx === target && item.cb === cb) {
				listenerSet.delete(item);
				break;
			}
		}
		if (listenerSet.size === 0) {
			this._signalMap.delete(signalKey);
			return;
		}
	}

	/**
	 * 发射信号，执行全部有效监听
	 * 惰性清理：自动移除上下文已被GC回收的失效监听
	 * 异常隔离：单回调报错不阻塞其余监听执行
	 * @param signalKey 待发射信号名称
	 * @param args 信号参数，严格匹配泛型定义元组
	 */
	emit<K extends keyof T>(signalKey: K, ...args: T[K]): void {
		const listenerSet = this._signalMap.get(signalKey);
		if (!listenerSet || listenerSet.size === 0) return;
		const snapshot = Array.from(listenerSet);
		let needCleanEmpty = false;
		for (const item of snapshot) {
			const ctx = item.targetRef.deref();
			if (!ctx) {
				listenerSet.delete(item);
				needCleanEmpty = true;
				continue;
			}
			try {
				item.cb.apply(ctx, args);
			} catch (err) {
				console.error(`信号[${String(signalKey)}]回调执行异常：`, err);
			}
			if (item.once) {
				listenerSet.delete(item);
				needCleanEmpty = true;
			}
		}
		if (needCleanEmpty && listenerSet.size === 0) {
			this._signalMap.delete(signalKey);
		}
	}

	/**
	 * 清空发射器全部信号监听
	 * @param signalKey 传入信号名仅清空该信号；不传则清空全部信号池
	 */
	clear(signalKey?: keyof T): void {
		if (signalKey) {
			this._signalMap.delete(signalKey);
		} else {
			this._signalMap.clear();
		}
	}
}
