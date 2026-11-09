/**
 * 数据模型实例契约。
 * 被 DataModel.instance 管理、可被统一 reset 的类都实现此接口。
 */
export interface IDataModel {
	/** 初始化数据或操作 */
	init(): void;
	/** 重置数据或操作 */
	reset(): void;
	/** 重置运行时缓存 */
	resetCacheData(): void;
	/** 重置本地数据 */
	resetLocalData(): void;
}

/**
 * 数据模型构造器契约。
 * uniqueKey 挂在构造函数上作为静态属性，用于单例注册表的 key。
 * 子类必须声明为非空字符串，且不得沿用基类默认值 "DataModel"。
 */
export interface IDataModelCtor<T extends DataModel = DataModel> {
	new (): T;
	/** 静态唯一键，子类必须声明为非空字符串 */
	readonly uniqueKey: string;
}

/**
 * 本地数据结构约束。
 * 允许业务自定义任意字段；createTime / updateTime 由 saveLocalData 自动维护。
 */
export interface ILocalData {
	[key: string]: any;
	/** 创建时间，首次保存时写入 */
	createTime?: string;
	/** 更新时间，每次保存时刷新 */
	updateTime?: string;
}

/******************************************************************
 *
 * ModuleName: 数据模型集合，统一重置。
 *
 * @Description:
 *   数据模型基类，提供单例注册、账号隔离、本地数据读写、统一重置能力。
 *   - 每个子类通过 static uniqueKey 全局唯一标识，instance 按 key 缓存实例。
 *   - 实例创建时依次执行 init()，成功后写入注册表，避免半初始化实例污染单例表。
 *   - 支持按账号隔离本地数据（isNeedAccount 为 true 时 key 拼接 account）。
 *   - 统一 reset 支持优先重置列表（resetFirstModel），其余按注册顺序执行。
 *   - 同时导出数据代理类 BaseData / ObjectData，封装值并支持事件通知。
 *
 ******************************************************************/

export default abstract class DataModel implements IDataModel {
	/**
	 * 唯一标识（基类默认值，子类必须覆盖）。
	 * 作为单例注册表的 key；instance 会拒绝等于该默认值的构造器，
	 * 防止子类忘记声明 uniqueKey 时互相覆盖。
	 */
	static uniqueKey = "DataModel";

	/** 登录标识；isNeedAccount 的模型用它拼接本地存储 key */
	static account: string = "";

	/** 优先重置的模型数据 key 列表（存储副本，防外部污染） */
	private static _resetFirstModel: readonly string[] = [];

	/** 数据模型单例注册表：uniqueKey -> 实例 */
	private static readonly models: Map<string, DataModel> = new Map();

	/** 正在初始化中的 key，用于检测循环 init */
	private static readonly initializing: Set<string> = new Set();

	// ==================================================================
	// 单例获取
	// ==================================================================

	/**
	 * 获取（或首次创建）数据模型实例。
	 *
	 * 行为保证：
	 * 1. ctor 非法时抛出带类名的明确错误，而不是 "Cannot read property of undefined"
	 * 2. uniqueKey 为空或沿用基类默认值时抛出明确错误
	 * 3. init() 成功后才写入注册表，避免半初始化实例污染单例表
	 * 4. 检测 init() 期间对自身的循环调用，避免无限递归
	 *
	 * @param ctor 数据模型构造器，需带 static uniqueKey
	 * @returns    唯一实例（首次创建，之后复用）
	 */
	static instance<T extends DataModel>(ctor: IDataModelCtor<T>): T {
		if (typeof ctor !== "function") {
			throw new Error("DataModel.instance: ctor is required and must be a constructor");
		}

		const uniqueKey = ctor.uniqueKey;
		if (uniqueKey == null || uniqueKey === "") {
			throw new Error(`DataModel ${ctor.name || "<anonymous>"} must have a non-empty uniqueKey`);
		}
		if (uniqueKey === "DataModel") {
			throw new Error(`DataModel ${ctor.name || "<anonymous>"} must override static uniqueKey`);
		}
		// 已创建，直接返回
		const existing = DataModel.models.get(uniqueKey) as T | undefined;
		if (existing) return existing;
		// 循环 init 检测
		if (DataModel.initializing.has(uniqueKey)) {
			throw new Error(`DataModel ${uniqueKey} is being initialized (circular init detected)`);
		}
		DataModel.initializing.add(uniqueKey);
		try {
			const created = new ctor();
			created.init();
			DataModel.models.set(uniqueKey, created);
			return created;
		} finally {
			DataModel.initializing.delete(uniqueKey);
		}
	}

	/**
	 * 语法糖：XxxModel.getInstance()。
	 * 依赖子类声明 static readonly uniqueKey，this 类型自动收窄到具体子类。
	 */
	static getInstance<T extends DataModel>(this: IDataModelCtor<T>): T {
		return DataModel.instance(this);
	}

	/**
	 * 指定模型是否已创建。
	 * @param ctor 数据模型构造器
	 */
	static has<T extends DataModel>(ctor: IDataModelCtor<T>): boolean {
		return DataModel.models.has(ctor.uniqueKey);
	}

	/** 当前已创建的模型数量（调试用） */
	static get size(): number {
		return DataModel.models.size;
	}

	/** 设置优先重置的模型 key 列表（存副本，防外部修改影响内部） */
	static set resetFirstModel(keys: readonly string[]) {
		DataModel._resetFirstModel = [...keys];
	}

	/** 读取优先重置的模型 key 列表（只读副本） */
	static get resetFirstModel(): readonly string[] {
		return DataModel._resetFirstModel;
	}

	/**
	 * 重置所有模型数据。
	 * 优先列表中的先执行；其余按注册表顺序执行。
	 *
	 * @remarks
	 * 仅调用 reset()，不重建实例、不重新 loadLocalData。
	 * 若子类 reset 需要重新加载本地数据，请在子类 reset 内自行调用 loadLocalData。
	 * 优先列表里不存在于注册表的 key 会被跳过。
	 */
	static reset(): void {
		const priority = new Set(DataModel._resetFirstModel);

		// 先重置优先列表中的模型
		for (const key of priority) {
			const model = DataModel.models.get(key);
			if (!model) continue;
			model.reset();
		}

		// 再重置其余模型（跳过已处理的优先项）
		for (const [key, model] of DataModel.models) {
			if (priority.has(key)) continue;
			model.reset();
		}
	}

	/**
	 * 销毁所有模型。
	 * 用于热重载、切场景彻底清理等场景；与 reset 不同，clear 后实例不可复用，
	 * 再次 instance 会重新创建并执行 init()。
	 * 同时清空账号标识与优先重置列表。
	 */
	static clear(): void {
		DataModel.models.clear();
		DataModel.initializing.clear();
		DataModel._resetFirstModel = [];
		DataModel.account = "";
	}

	/**
	 * 在当前模型实例上获取（或创建）其他数据模型。
	 * 等价于 DataModel.instance(ctor)，仅提供链式写法。
	 * @param ctor 数据模型构造器
	 */
	getModel<T extends DataModel>(ctor: IDataModelCtor<T>): T {
		return DataModel.instance(ctor);
	}

	/** 模型名字（用于本地存储 key；与静态 uniqueKey 可相同，也可不同） */
	protected abstract modelName: string;

	/** 运行时缓存数据（不落本地，reset 时通常重置） */
	protected abstract cacheData: any;

	/** 本地数据（落 localStorage 的部分，saveLocalData / loadLocalData 操作它） */
	protected abstract localData: ILocalData;

	/** 是否需要登录标记；为 true 时本地存储 key 会拼接 DataModel.account */
	protected abstract isNeedAccount: boolean;

	/** 初始化数据，app 启动后创建实例时调用 */
	abstract init(): void;

	/** 重置数据或操作；统一 reset 时调用 */
	abstract reset(): void;

	/** 重置运行时缓存 */
	abstract resetCacheData(): void;

	/** 重置本地数据 */
	abstract resetLocalData(): void;
}
