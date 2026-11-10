/**
 * 回调的统一签名：参数列表不限，返回值忽略。
 * 以函数引用做去重 / 移除匹配，业务侧传方法引用或箭头函数均可。
 */
export type EventCallback = (...args: any[]) => void;

/**
 * 递归只读视图。
 * Readonly<T> 只约束顶层，嵌套对象 / 数组内部字段仍可写；
 * DeepReadonly 递归展开，用于 getInfo / getInfoByKey 的返回类型，
 * 在编译期阻止对数据模型内部结构的修改。
 */
export type DeepReadonly<T> = T extends (...args: any[]) => any
	? T
	: T extends object
		? { readonly [K in keyof T]: DeepReadonly<T[K]> }
		: T;

/**
 * 内部绑定项：记录回调及其绑定对象，仅用于 bindFunction 存储。
 * 使用 target 而非 this 绑定，保证回调内 this 指向调用方期望的对象。
 */
interface BindItem {
	/** 回调绑定的对象，即 callBack.call(target, ...) 的 this */
	target: any;
	/** 实际存入绑定表的函数；once 项为一次性包装函数，非原回调 */
	callBack: EventCallback;
	/** 原始回调：普通项与 callBack 相同；once 项为包装前的原回调，供 off 按原回调移除 */
	originCallBack: EventCallback;
	/** 是否为 once 包装项；与 originCallBack 共同参与去重，保证 on 与 once 可并存 */
	isOnce: boolean;
}

/**
 * 对外批量订阅或移除的描述项，作为 adds / offs 的参数元素。
 * target 由方法参数统一传入，描述项本身不携带 target。
 */
interface EventBindDesc {
	/** 事件名 */
	eventKey: string;
	/** 回调函数 */
	callBack: EventCallback;
	/** 是否为一次性订阅；缺省 false。adds 时生效，offs 忽略 */
	once?: boolean;
}

/******************************************************************
 * ModuleName: 事件观察 & 数据模型
 *
 * @Description:
 *   轻量级事件观察者（支持父子观察树）+ 基于它的对象数据模型。
 *   - 每个实例维护自己的 "事件名 -> 绑定项数组" 表（bindFunction）。
 *   - emit 从当前层出发深度优先遍历所有子观察者，先收集快照再统一回调；
 *     回调内增删订阅不影响本次遍历稳定性，单个回调抛错不中断其余回调。
 *   - once：包装函数带执行标志，嵌套 emit 持有的旧快照不会二次触发；
 *     绑定表额外记录原始回调，off 可按原回调精确移除 once 项。
 *   - destroy 后实例进入拒绝态：订阅 / 触发被忽略并告警，移除静默放行。
 *   - SuperData：对象数据模型基类，update 做形态 + 结构同构校验，
 *     按 "变化的顶层 key + onFullKey" 通知。
 *   - ObjectData：对外对象模型，支持按 key 更新（含属性级结构校验）与订阅。
 *
 ******************************************************************/
export class EventObserver {
	/**
	 * 父观察者。
	 * - 构造时若传入 parentEventSubject，则把自己注册到父级的子列表中。
	 * - 根观察者（未传父级）为 null。
	 * - destroy 后置为 null，表示已脱离观察树。
	 */
	private parentEventSubject: EventObserver | null = null;

	/**
	 * 子观察者列表。
	 * emit / removeEventsByTarget / destroy 都会递归到子级。
	 * 由 addSubEventSubjects 维护，removeSubEventSubjects / destroy 移除。
	 */
	private subEventSubjects: EventObserver[] = [];

	/**
	 * 事件绑定表：事件名 -> 绑定项数组。
	 * 同一事件名可绑定多个组合；
	 * add 按 (target, 原始回调, 是否 once) 去重，on 与 once 视为不同订阅可并存。
	 */
	private bindFunction: Map<string, BindItem[]> = new Map();

	/** 销毁标记：destroy 后置 true，订阅 / 触发被拒绝并告警，移除静默放行为空操作 */
	private destroyed = false;

	/** 是否已销毁。供本类与子类（SuperData）做前置守卫；销毁后实例不应再使用 */
	get isDestroyed(): boolean {
		return this.destroyed;
	}

	/**
	 * 创建事件观察对象。
	 * @param parentEventSubject 父级观察者；传入后当前实例会加入其子列表，
	 *                           之后父级 emit 可触达当前实例的订阅。
	 *                           不传则为根观察者。
	 */
	constructor(parentEventSubject?: EventObserver) {
		this.parentEventSubject = parentEventSubject ?? null;
		this.addToParent();
	}

	/**
	 * 添加单个事件订阅。
	 * @param target   回调绑定的对象（回调内 this 指向它）
	 * @param eventKey 事件名
	 * @param callBack 回调函数
	 *
	 * @remarks
	 * 去重：同 eventKey 下，同 target 且同 callBack 的普通订阅只保留一份；
	 * on 与 once 视为不同订阅，同回调可并存。
	 */
	on(target: any, eventKey: string, callBack: EventCallback): void {
		this.add(eventKey, target, callBack);
	}

	/**
	 * 添加单个一次性事件订阅：触发一次后自动解绑。
	 * @param target   回调绑定的对象（回调内 this 指向它）
	 * @param eventKey 事件名
	 * @param callBack 回调函数
	 *
	 * @remarks
	 * 注册时把 callBack 包装为一次性函数存入绑定表，并额外记录原回调：
	 * - 包装函数带执行标志（fired）：即使嵌套 emit 的旧快照再次调用它，也不会二次触发；
	 * - 触发时先按包装函数自身引用精确解绑，再调用原回调；
	 *   回调抛错前已解绑（once 语义不因异常回滚）；
	 * - 移除方式：off(target, eventKey, callBack) 按原回调精确移除（含 once 项）、
	 *   off(target, eventKey) 整体清除、removeEventsByTarget 按 target 清理；
	 * - 去重：同 target 且同原回调的 once 只保留一份。
	 */
	once(target: any, eventKey: string, callBack: EventCallback): void {
		let fired = false;
		const wrapped: EventCallback = (...args: any[]) => {
			if (fired) return; // 嵌套 emit 的旧快照再次调用时直接跳过
			fired = true;
			this.remove(target, eventKey, wrapped); // 按包装函数自身引用精确移除，不影响并存的其他订阅
			callBack.call(target, ...args);
		};
		// 传入原回调用于去重与 off 匹配
		this.add(eventKey, target, wrapped, true, callBack);
	}

	/**
	 * 添加事件（内部实现）。
	 * @param eventKey       事件名
	 * @param target         回调绑定对象
	 * @param callBack       实际存入绑定表的函数（once 场景为包装函数）
	 * @param isOnce         是否为 once 包装项
	 * @param originCallBack 原始回调；缺省取 callBack
	 *
	 * @remarks
	 * 去重规则：同 eventKey 下，target、originCallBack、isOnce 三者都相同的项只保留一份。
	 * 复杂度：O(n)，n 为该事件名现有绑定数。
	 * destroy 后拒绝订阅：console.warn 并返回。
	 */
	private add(
		eventKey: string,
		target: any,
		callBack: EventCallback,
		isOnce = false,
		originCallBack?: EventCallback,
	): void {
		if (this.destroyed) {
			console.warn("[EventObserver] 实例已 destroy，忽略订阅:", eventKey);
			return;
		}
		const orig = originCallBack ?? callBack;
		let callBacks = this.bindFunction.get(eventKey);
		if (!callBacks) {
			callBacks = [];
			this.bindFunction.set(eventKey, callBacks);
		}
		for (let i = 0; i < callBacks.length; i++) {
			const item = callBacks[i];
			if (item.target === target && item.originCallBack === orig && item.isOnce === isOnce) return;
		}
		callBacks.push({ target, callBack, originCallBack: orig, isOnce });
	}

	/**
	 * 添加多个事件订阅。
	 * @param target 所有回调统一绑定的对象
	 * @param obj    订阅描述数组，每项含 eventKey、callBack 与可选 once
	 *
	 * @remarks
	 * 普通项直接 add；once 项走 once() 的包装逻辑。
	 * once 项后续可通过 offs / off 按原回调移除（originCallBack 匹配）。
	 *
	 * @example
	 *   observer.adds(this, [
	 *     { eventKey: "gold", callBack: this.onGold },
	 *     { eventKey: "alert", callBack: this.onAlert, once: true },
	 *   ]);
	 */
	adds(target: any, obj: EventBindDesc[]): void {
		for (let i = 0; i < obj.length; i++) {
			const item = obj[i];
			if (item.once) {
				this.once(target, item.eventKey, item.callBack);
			} else {
				this.add(item.eventKey, target, item.callBack);
			}
		}
	}

	/**
	 * 移除事件订阅。
	 * @param target   回调绑定对象
	 * @param eventKey 事件名
	 * @param callBack 可选回调函数
	 *
	 * @remarks
	 * - 不传 callBack：清除该事件名下的全部绑定（含 once 项）；
	 * - 传入原回调：精确移除该项的所有订阅——普通项与以其为原回调的 once 项；
	 * - 事件名不存在会 console.warn；destroy 后静默放行为空操作。
	 */
	off(target: any, eventKey: string, callBack?: EventCallback): void {
		this.remove(target, eventKey, callBack);
	}

	/**
	 * 移除订阅（内部实现）。
	 * @param target   回调绑定对象
	 * @param eventKey 事件名
	 * @param callBack 可选回调函数；不传则清除该事件名下的全部绑定
	 *
	 * @remarks
	 * - destroy 后静默返回（销毁实例的清理路径不应产生告警噪音）。
	 * - 事件名不存在：console.warn 后返回。
	 * - 未传 callBack：直接删除整个事件名的绑定表。
	 * - 传了 callBack：双字段匹配——item.callBack === callBack（once 包装函数自移除时命中，
	 *   仅命中自身）或 item.originCallBack === callBack（业务按原回调移除时命中，
	 *   同时移除普通项与对应 once 项），保留其余。
	 */
	private remove(target: any, eventKey: string, callBack?: EventCallback): void {
		if (this.destroyed) return;
		const callBacks = this.bindFunction.get(eventKey);
		if (!callBacks) {
			console.warn("[EventObserver] 没有找到事件:", eventKey);
			return;
		}
		if (!callBack) {
			this.bindFunction.delete(eventKey);
			return;
		}
		for (let i = callBacks.length - 1; i >= 0; i--) {
			const item = callBacks[i];
			if (item.target === target && (item.callBack === callBack || item.originCallBack === callBack)) {
				callBacks.splice(i, 1);
			}
		}
		if (callBacks.length === 0) {
			this.bindFunction.delete(eventKey);
		}
	}

	/**
	 * 批量移除订阅。
	 * @param target 绑定的对象（所有描述项共用同一 target）
	 * @param events 数组，每项含 eventKey 与 callBack
	 *
	 * @remarks
	 * 参数顺序与 adds(target, obj) 对齐，均为 target 在前。
	 * 逐项调用 remove；任一项事件名不存在会 console.warn，不中断后续项。
	 * 描述项里的 once 字段在此被忽略；once 项可按原回调移除（originCallBack 匹配）。
	 */
	offs(target: any, events: EventBindDesc[]): void {
		for (let i = 0; i < events.length; i++) {
			const item = events[i];
			this.remove(target, item.eventKey, item.callBack);
		}
	}

	/**
	 * 移除指定 target 的所有事件（递归到子观察者）。
	 * @param target 要清理的回调绑定对象
	 *
	 * @remarks
	 * 遍历当前 bindFunction，删除所有 item.target === target 的项（含 once 包装项）；
	 * 某事件名删空后从 Map 中移除该 key。
	 * 随后对每个子观察者递归执行同样清理。
	 * 常用于对象销毁时统一解绑，避免回调悬挂。
	 */
	removeEventsByTarget(target: any): void {
		for (const [key, callBacks] of this.bindFunction) {
			for (let i = callBacks.length - 1; i >= 0; i--) {
				if (callBacks[i].target === target) {
					callBacks.splice(i, 1);
				}
			}
			if (callBacks.length === 0) {
				this.bindFunction.delete(key);
			}
		}
		const subs = this.subEventSubjects.slice();
		for (let i = 0; i < subs.length; i++) {
			subs[i].removeEventsByTarget(target);
		}
	}

	/**
	 * 把当前对象添加到父级的子级容器中。
	 * 构造时调用；根观察者 parentEventSubject 为 null，空操作。
	 */
	private addToParent(): void {
		this.parentEventSubject?.addSubEventSubjects(this);
	}

	/**
	 * 把子观察者加入当前实例的子列表（内部，供子级构造时回调）。
	 * @param subEventSubject 子观察者
	 */
	private addSubEventSubjects(subEventSubject: EventObserver): void {
		this.subEventSubjects.push(subEventSubject);
	}

	/**
	 * 把当前对象从父级的子列表中移除（内部，destroy 时调用）。
	 * @param subEventSubject 通常传 this
	 */
	private removeFromParent(subEventSubject: EventObserver): void {
		this.parentEventSubject?.removeSubEventSubjects(subEventSubject);
	}

	/**
	 * 从子列表中移除指定子观察者（内部）。
	 * @param subEventSubject 要移除的子观察者
	 *
	 * @remarks 原地 splice，找不到则静默返回。
	 */
	private removeSubEventSubjects(subEventSubject: EventObserver): void {
		const subs = this.subEventSubjects;
		for (let i = 0; i < subs.length; i++) {
			if (subs[i] === subEventSubject) {
				subs.splice(i, 1);
				return;
			}
		}
	}

	/**
	 * 通知事件。
	 * 遍历顺序：当前观察者绑定项 -> 各子观察者（深度优先）。
	 * @param eventKey 事件名
	 * @param args     透传给回调的参数，可多个
	 *
	 * @remarks
	 * - destroy 后拒绝：console.warn 并返回。
	 * - 先收集所有匹配的 BindItem 到临时数组（快照），再统一回调。
	 *   即使某个回调内部增删订阅，也不影响本次遍历的稳定性
	 *   （新增的绑定不在本轮触发，删除的绑定仍按快照执行）。
	 * - once 项的包装函数自带执行标志与自解绑，无需在此特殊处理；
	 *   快照中残留的已触发 once 项再次被调用时会被标志拦截。
	 * - 单个回调抛错会被捕获并 console.error，不中断其余回调。
	 */
	emit(eventKey: string, ...args: any[]): void {
		if (this.destroyed) {
			console.warn("[EventObserver] 实例已 destroy，忽略 emit:", eventKey);
			return;
		}
		const notificationArray: BindItem[] = [];
		this.findBindFunctionByEventKey(eventKey, notificationArray);
		for (let i = 0; i < notificationArray.length; i++) {
			const item = notificationArray[i];
			try {
				item.callBack.call(item.target, ...args);
			} catch (err) {
				console.error("[EventObserver] callback error on event:", eventKey, err);
			}
		}
	}

	/**
	 * 递归收集当前观察者及其子观察者中匹配 eventKey 的绑定项。
	 * @param eventKey          事件名
	 * @param notificationArray 收集结果输出数组（由调用方传入并复用）
	 *
	 * @remarks
	 * - 当前层：直接 bindFunction.get(eventKey)，O(1)。
	 * - 子层：对每个子观察者递归。
	 * - 收集顺序即回调顺序：当前层先，子层按加入顺序。
	 */
	private findBindFunctionByEventKey(eventKey: string, notificationArray: BindItem[]): void {
		const callBacks = this.bindFunction.get(eventKey);
		if (callBacks) {
			for (let i = 0; i < callBacks.length; i++) {
				notificationArray.push(callBacks[i]);
			}
		}
		const subs = this.subEventSubjects;
		for (let i = 0; i < subs.length; i++) {
			subs[i].findBindFunctionByEventKey(eventKey, notificationArray);
		}
	}

	/**
	 * 销毁当前观察者及其所有子观察者。幂等：重复调用无副作用。
	 *
	 * @remarks
	 * 1. 置 destroyed 标志（此后订阅 / 触发被拒绝，移除静默放行）；
	 * 2. 从父级子列表移除自己，parentEventSubject 置 null；
	 * 3. 递归销毁所有子观察者；
	 * 4. 清空子列表与绑定表（含 once 包装项）。
	 *
	 * 销毁后实例不应再使用；如需复用请重新 new。
	 * 与 reset 不同，destroy 不可逆。
	 */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.removeFromParent(this);
		this.parentEventSubject = null;
		const subs = this.subEventSubjects.slice();
		this.subEventSubjects.length = 0;
		for (let i = 0; i < subs.length; i++) {
			subs[i].destroy();
		}
		this.bindFunction.clear();
	}
}

/**
 * 数据模型基类：封装普通对象，支持事件通知。
 * - 仅接受普通对象：构造与 update 均拒绝 null / 数组 / 基础类型（运行时 throw）。
 * - update 做结构同构校验（key 集合、层级、叶子形态一致），保证订阅方拿到的
 *   嵌套对象字段齐全；变化的顶层 key 发属性名事件，最后发 onFullKey。
 * - 删除顶层 key 因结构校验不可能发生。
 * 作为 ObjectData 的公共父类，不直接对外使用。
 */
class SuperData<T extends object> extends EventObserver {
	/** 整体值更新后的通知事件名。属性名应避免使用该保留事件名，否则会与之冲突 */
	protected static readonly onFullKey = "onFullKey";

	/** 当前封装的值。构造校验保证非空；仅 destroy 后置为 null */
	protected value: T;

	/**
	 * @param data 初始对象
	 *
	 * @remarks
	 * 初始值即后续 update 的结构基准。若初始值形态非法，直接 throw 拒绝创建。
	 */
	constructor(data: T) {
		super();
		if (!this.isValidInit(data)) {
			throw new Error("[SuperData] 初始值形态非法：仅接受普通对象，拒绝 null / 数组 / 基础类型");
		}
		this.value = data;
	}

	/**
	 * 初始值 / 更新值合法性校验：仅接受普通对象。
	 * 拒绝 null / undefined / 数组 / 基础类型（含函数）。
	 * 子类可覆写以进一步收紧（如校验必填字段）；不建议放宽为非对象形态，
	 * 否则 update 的逐 key 通知机制会失准。
	 */
	protected isValidInit(v: T): boolean {
		if (v == null) return false;
		if (Array.isArray(v)) return false;
		return typeof v === "object";
	}

	/**
	 * 更新封装值。
	 *
	 * 流程：
	 * 1. destroy 后拒绝：console.warn 并忽略，value 不变。
	 * 2. 形态校验（复用 isValidInit）：非法形态 throw，value 不变。
	 * 3. 内容对比：深度相等则静默返回（相等必然同构，可省去结构校验一趟遍历）。
	 * 4. 结构校验：新旧不同时必须同构（key 集合、层级、叶子形态一致），否则 throw。
	 * 5. 通知：变化的顶层 key 发属性名事件（传新值）；最后发 onFullKey（传整值）。
	 *
	 * @param v 新值
	 *
	 * @remarks
	 * - 通知粒度为顶层 key，嵌套变化发父 key 整个新值，不展开路径。
	 * - 删除 key 会被结构校验拒绝，因此不会出现 "发 undefined" 的情况。
	 * - onFullKey 与逐 key 事件并存：同时订阅两者会收到多次回调，订阅方按需选择。
	 * - 判重用深度相等（内容比较）：同内容新引用不通知；需要引用级刷新的
	 *   单 key 写入请用 ObjectData.updateInfoByKey（引用比较）。
	 * - 每次调用至多两趟深递归（内容相同时仅一趟）；大对象高频更新注意开销。
	 */
	update(v: T): void {
		if (this.isDestroyed) {
			console.warn("[SuperData] update 时实例已 destroy，忽略");
			return;
		}
		if (!this.isValidInit(v)) {
			throw new Error("[SuperData] update 拒绝：新值形态非法（仅接受普通对象，拒绝 null / 数组 / 基础类型）");
		}
		const oldValue = this.value;
		// 内容相同必然同构，先短路，省掉一趟结构遍历
		if (SuperData.deepEqual(oldValue, v)) return;
		if (!SuperData.sameShape(oldValue, v)) {
			throw new Error("[SuperData] update 拒绝：新值与旧值结构不一致");
		}
		this.value = v;
		const oldObj = oldValue as any;
		const newObj = v as any;
		const newKeys = Object.keys(newObj);
		for (let i = 0; i < newKeys.length; i++) {
			const key = newKeys[i];
			if (SuperData.deepEqual(oldObj[key], newObj[key])) continue;
			this.emit(key, newObj[key]);
		}
		this.emit(SuperData.onFullKey, v);
	}

	/**
	 * 值的运行时形态，用于形态一致性校验。
	 * - null / undefined → "null"
	 * - 数组 → "array"
	 * - 其它 → typeof（"object" / "number" / "string" / "boolean" / "symbol" / "bigint" / "function"）
	 */
	private static getKind(v: any): string {
		if (v == null) return "null";
		if (Array.isArray(v)) return "array";
		return typeof v;
	}

	/**
	 * 结构同构校验：递归比较 key 集合与层级，忽略具体值。
	 * - 基础类型 / 函数：只需形态相同（同为 string/number/...）。
	 * - 数组：长度相同，且逐项同构（用于嵌套数组属性）。
	 * - 对象：自有 key 集合相同，且逐 key 同构。
	 * - 循环引用：按已访问对象对跳过。
	 *
	 * @param a 旧值
	 * @param b 新值
	 * @param seen 循环引用防护，内部递归使用
	 *
	 * @remarks
	 * update 与 ObjectData.updateInfoByKey 共用，保证订阅方拿到的嵌套对象字段齐全，
	 * 不会因缺字段而访问 undefined。
	 */
	protected static sameShape(a: any, b: any, seen?: WeakMap<object, WeakSet<object>>): boolean {
		const ka = SuperData.getKind(a);
		const kb = SuperData.getKind(b);
		if (ka !== kb) return false;
		if (ka !== "object" && ka !== "array") return true;

		if (!seen) seen = new WeakMap();
		let set = seen.get(a);
		if (set && set.has(b)) return true;
		if (!set) {
			set = new WeakSet();
			seen.set(a, set);
		}
		set.add(b);

		if (ka === "array") {
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) {
				if (!SuperData.sameShape(a[i], b[i], seen)) return false;
			}
			return true;
		}

		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		for (let i = 0; i < aKeys.length; i++) {
			const key = aKeys[i];
			if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
			if (!SuperData.sameShape(a[key], b[key], seen)) return false;
		}
		return true;
	}

	/**
	 * 深度相等判定。
	 * - 基础类型 / 函数 / 引用相同：=== 判定（NaN 视为相等）。
	 * - 数组：长度相同且逐项 deepEqual。
	 * - 普通对象：自有 key 集合相同且逐 key deepEqual。
	 * - 循环引用：用 seen 对记录已比较过的对象对，命中视为相等（避免爆栈）。
	 *
	 * @param a 旧值
	 * @param b 新值
	 * @param seen 循环引用防护，内部递归使用
	 */
	private static deepEqual(a: any, b: any, seen?: WeakMap<object, WeakSet<object>>): boolean {
		if (a === b) return true;
		// NaN 视为相等
		if (a !== a && b !== b) return true;
		if (a == null || b == null) return false;
		if (typeof a !== "object" || typeof b !== "object") return false;
		if (Array.isArray(a) !== Array.isArray(b)) return false;

		if (!seen) seen = new WeakMap();
		let set = seen.get(a);
		if (set && set.has(b)) return true;
		if (!set) {
			set = new WeakSet();
			seen.set(a, set);
		}
		set.add(b);
		if (Array.isArray(a)) {
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) {
				if (!SuperData.deepEqual(a[i], b[i], seen)) return false;
			}
			return true;
		}

		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		for (let i = 0; i < aKeys.length; i++) {
			const key = aKeys[i];
			if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
			if (!SuperData.deepEqual(a[key], b[key], seen)) return false;
		}
		return true;
	}

	/**
	 * 读取当前值（递归只读视图，调用方不应修改）。
	 * destroy 后 console.warn 并返回 null。
	 */
	getInfo(): DeepReadonly<T> {
		if (this.isDestroyed) {
			console.warn("[SuperData] getInfo 时实例已 destroy");
			return null as unknown as DeepReadonly<T>;
		}
		return this.value as unknown as DeepReadonly<T>;
	}

	/**
	 * 读取对象某属性。
	 * @param k 属性名
	 * @returns 属性值的递归只读视图
	 *
	 * @remarks
	 * - 编译期由 DeepReadonly 禁止修改（含嵌套字段）；
	 * - 运行时未冻结，绕过类型系统强行修改内部引用会破坏通知一致性；
	 * - destroy 后 console.warn 并返回 undefined。
	 */
	getInfoByKey<K extends keyof T>(k: K): DeepReadonly<T[K]> {
		if (this.isDestroyed) {
			console.warn("[SuperData] get 时实例已 destroy（value 已清空）");
			return undefined as unknown as DeepReadonly<T[K]>;
		}
		return this.value[k] as unknown as DeepReadonly<T[K]>;
	}

	/** 销毁：先走 EventObserver 清理订阅并置 destroyed 标志，再清空值 */
	destroy(): void {
		super.destroy();
		this.value = null as unknown as T;
	}
}

/**
 * 代理对象：引用类型数据模型。
 * - 事件名即属性名，订阅方用 on(target, "属性名", cb) 订阅；整体变更用 onFullValue。
 * - 初始值与 update 均拒绝数组 / null / 基础类型（运行时 throw），保证 value 恒为普通对象。
 *   说明：T extends object 在编译期挡不住数组（number[] extends object 成立），
 *   数组在运行时由 isValidInit 拦截。
 * - 判重语义：update 用深度相等（内容比较）；updateInfoByKey 用引用比较。
 *   两处语义不同，按需选择。
 */
export class ObjectData<T extends object> extends SuperData<T> {
	/**
	 * @param data 初始对象
	 */
	constructor(data: T) {
		super(data);
	}

	/**
	 * 设置对象某属性；与旧值引用相同则忽略，不同则校验结构后更新并通知该 key。
	 * @param k 属性名
	 * @param v 新值
	 *
	 * @remarks
	 * - 判重用 === 引用比较（NaN 视为相等）：对象 / 数组属性赋新引用即通知，即使内容相同。
	 *   与 update 的深度相等判重不同：需要 "同内容新引用也刷新"（如 UI 强刷）时用本方法；
	 * - 结构校验：属性新值必须与旧值同构（key 集合、层级、叶子形态一致），否则 throw。
	 *   与 update 的结构保证对齐，堵住绕过 update 破坏同构、导致后续 update 必然失败的口子；
	 * - destroy 后 console.warn 并忽略。
	 */
	updateInfoByKey<K extends keyof T>(k: K, v: T[K]): void {
		if (this.isDestroyed) {
			console.warn("[ObjectData] updateInfoByKey 时实例已 destroy（value 已清空），忽略");
			return;
		}
		const old = this.value[k];
		if (old === v || (old !== old && v !== v)) return;
		if (!SuperData.sameShape(old, v)) {
			throw new Error("[ObjectData] updateInfoByKey 拒绝：属性新值与旧值结构不一致");
		}
		this.value[k] = v;
		this.emit(k as string, v);
	}

	/**
	 * 订阅某属性变更，并立即推送一次当前值。
	 * @param eventKey 属性名
	 * @param callBack 值变更回调
	 * @param target   回调绑定对象（回调内 this）
	 *
	 * @remarks
	 * 订阅后立即用当前属性值回调一次，便于调用方初始化 UI 等。
	 * 注意：参数顺序为 (eventKey, callBack, target)，与 on(target, eventKey, callBack) 不同。
	 */
	onValueChangeByKey<K extends keyof T>(eventKey: K, callBack: (v: T[K]) => void, target: any): void {
		const keyStr = String(eventKey);
		this.on(target, keyStr, callBack);
		// 立即推送一次当前值（destroyed 时上面的 on 已告警并跳过，此处同样跳过）
		if (!this.isDestroyed) {
			callBack.call(target, this.value[eventKey]);
		}
	}

	/**
	 * 订阅整体值变更（onFullKey 事件），并立即推送一次当前值。
	 * @param callBack 整值变更回调
	 * @param target   回调绑定对象（回调内 this）
	 *
	 * @remarks
	 * update 触发时整值回调；与按 key 订阅并存——同时订阅两者会收到多次回调，按需选择。
	 */
	onFullValue(callBack: (v: T) => void, target: any): void {
		this.on(target, SuperData.onFullKey, callBack);
		if (!this.isDestroyed) {
			callBack.call(target, this.value);
		}
	}
}
