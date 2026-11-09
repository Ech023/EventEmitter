import DataModel, { IDataModelCtor } from "./DataModel";

/**
 * 管理器实例契约。
 * 被 Manager.instance 管理、可被统一 reset 的类都实现此接口。
 */
export interface IManager {
	/** 初始化数据或操作 */
	init(): void;
	/** 重置数据或操作 */
	reset(): void;
}

/**
 * 管理器构造器契约。
 * uniqueKey 挂在构造函数上作为静态属性，用于单例注册表的 key。
 * 子类必须声明为非空字符串。
 */
export interface IManagerCtor<T extends Manager = Manager> {
	new (): T;
	/** 静态唯一键，子类必须声明为非空字符串 */
	readonly uniqueKey: string;
}

/******************************************************************
 * ModuleName: 管理器集合，统一重置
 *
 * @Description:
 *   管理器基类，提供单例注册、统一重置、彻底清理能力。
 *   - 每个子类通过 static uniqueKey 全局唯一标识，instance 按 key 缓存实例。
 *   - 实例创建时执行 init()，成功后才写入注册表，避免半初始化实例污染单例表。
 *   - 支持优先重置列表（resetFirstManager），其余按注册顺序执行。
 *   - 提供 getModel / getManager 便捷方法，便于在管理器内获取其他单例。
 *
 ******************************************************************/
export default abstract class Manager implements IManager {
	/** 管理器单例注册表：uniqueKey -> 实例 */
	private static readonly managers: Map<string, Manager> = new Map();

	/** 优先重置的管理器 key 列表（存储副本，避免外部数组被修改影响内部） */
	private static _resetFirstManager: readonly string[] = [];

	/** 正在初始化中的 key，用于检测循环 init */
	private static readonly initializing: Set<string> = new Set();

	/**
	 * 获取（或首次创建）管理器实例。
	 *
	 * 行为保证：
	 * 1. ctor 非法时抛出带类名的明确错误，而不是 "Cannot read property of undefined"
	 * 2. uniqueKey 为空时抛出明确错误
	 * 3. init() 成功后才写入注册表，避免半初始化实例污染单例表
	 * 4. 检测 init() 期间对自身的循环调用，避免无限递归
	 *
	 * @param ctor 管理器构造器，需带 static uniqueKey
	 * @returns    唯一实例（首次创建，之后复用）
	 */
	static instance<T extends Manager>(ctor: IManagerCtor<T>): T {
		if (typeof ctor !== "function") {
			throw new Error("Manager.instance: ctor is required and must be a constructor");
		}

		const uniqueKey = ctor.uniqueKey;
		if (uniqueKey == null || uniqueKey === "") {
			throw new Error(`Manager ${ctor.name || "<anonymous>"} must have a non-empty uniqueKey`);
		}

		// 已创建，直接返回
		const existing = Manager.managers.get(uniqueKey) as T | undefined;
		if (existing) return existing;

		// 循环 init 检测
		if (Manager.initializing.has(uniqueKey)) {
			throw new Error(`Manager ${uniqueKey} is being initialized (circular init detected)`);
		}

		Manager.initializing.add(uniqueKey);
		try {
			const created = new ctor();
			created.init();
			Manager.managers.set(uniqueKey, created);
			return created;
		} finally {
			Manager.initializing.delete(uniqueKey);
		}
	}

	/**
	 * 语法糖：XxxManager.getInstance()。
	 * 依赖子类声明 `static readonly uniqueKey`，this 类型自动收窄到具体子类。
	 */
	static getInstance<T extends Manager>(this: IManagerCtor<T>): T {
		return Manager.instance(this);
	}

	/**
	 * 指定管理器是否已创建。
	 * @param ctor 管理器构造器
	 */
	static has<T extends Manager>(ctor: IManagerCtor<T>): boolean {
		return Manager.managers.has(ctor.uniqueKey);
	}

	/** 当前已创建的管理器数量（调试用） */
	static get size(): number {
		return Manager.managers.size;
	}

	/** 设置优先重置的管理器 key 列表（存副本，防止外部修改影响内部） */
	static set resetFirstManager(keys: readonly string[]) {
		Manager._resetFirstManager = [...keys];
	}

	/** 读取优先重置的管理器 key 列表（只读副本） */
	static get resetFirstManager(): readonly string[] {
		return Manager._resetFirstManager;
	}

	/**
	 * 重置所有已创建的管理器。
	 * 优先列表中的先执行；其余按注册表顺序执行。
	 *
	 * @remarks
	 * - 仅调用各管理器的 reset()，不重建实例。
	 * - 优先列表里不存在于注册表的 key 会被跳过。
	 * - reset 过程中若某管理器抛错，会中断后续管理器的重置（与 for 循环语义一致）。
	 */
	static reset(): void {
		const priority = new Set(Manager._resetFirstManager);

		// 先重置优先列表中的管理器
		for (const key of priority) {
			Manager.managers.get(key)?.reset();
		}

		// 再重置其余管理器（跳过已处理的优先项）
		for (const [key, manager] of Manager.managers) {
			if (priority.has(key)) continue;
			manager.reset();
		}
	}

	/**
	 * 销毁所有管理器。
	 * 用于热重载、切场景彻底清理等场景；与 reset 不同，clear 后实例不可复用，
	 * 再次 instance 会重新创建并执行 init()。
	 * 同时清空优先重置列表。
	 */
	static clear(): void {
		Manager.managers.clear();
		Manager.initializing.clear();
		Manager._resetFirstManager = [];
	}

	/**
	 * 获取（或创建）数据模型实例。
	 * 等价于 DataModel.instance(ctor)，仅提供链式写法。
	 * @param ctor 数据模型构造器
	 */
	getModel<T extends DataModel>(ctor: IDataModelCtor<T>): T {
		return DataModel.instance(ctor);
	}

	/**
	 * 获取（或创建）其他管理器实例。
	 * 等价于 Manager.instance(ctor)，仅提供链式写法。
	 * @param ctor 管理器构造器
	 */
	getManager<T extends Manager>(ctor: IManagerCtor<T>): T {
		return Manager.instance(ctor);
	}

	/** 初始化数据或操作；实例首次创建时由 instance 调用一次 */
	abstract init(): void;

	/** 重置数据或操作；统一 reset 时调用 */
	abstract reset(): void;
}
