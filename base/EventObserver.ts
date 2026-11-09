/**
 * 单条绑定项：记录回调及其绑定对象。
 * 用 target 而非 this 绑定，保证回调内 this 指向调用方期望的对象。
 */
interface BindItem {
	/** 回调绑定的对象，即 callBack.call(target, ...) 的 this */
	target: any;
	/** 回调函数 */
	callBack: Function;
}

/**
 * 批量订阅描述项。
 * 注意：字段名 evnetKey 为历史拼写（非 eventKey），
 * 为兼容现有调用方而保留，新代码请沿用该字段名。
 */
interface EventBindDesc {
	/** 事件名（历史拼写，保留以兼容调用方） */
	evnetKey: string;
	/** 回调函数 */
	callBack: Function;
}
/******************************************************************
 * ModuleName: 事件观察
 *
 * @Description:
 *   轻量级事件观察者，支持父子观察树。
 *   - 每个实例维护自己的 "事件名 -> 绑定项数组" 表（bindFunction）。
 *   - 父子结构用于按层级组织订阅：notification 会从当前层出发，
 *     深度优先遍历所有子观察者，收集同事件名的绑定项后统一回调。
 *   - onEvents 每次调用会创建一个子观察者，便于把一批订阅作为整体销毁。
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
	 * notification / removeEventsByTarget / destroy 都会递归到子级。
	 * 由 addSubEventSubjects 维护，removeSubEventSubjects / destroy 移除。
	 */
	private subEventSubjects: EventObserver[] = [];

	/**
	 * 事件绑定表：事件名 -> 绑定项数组。
	 * 同一事件名可绑定多个 target/callBack 组合；
	 * add 会做去重（同 target 且同 callBack 只保留一份）。
	 */
	private bindFunction: Map<string, BindItem[]> = new Map();

	/**
	 * 创建事件观察对象。
	 * @param parentEventSubject 父级观察者；传入后当前实例会加入其子列表，
	 *                           之后父级 notification 可触达当前实例的订阅。
	 *                           不传则为根观察者。
	 */
	constructor(parentEventSubject?: EventObserver) {
		if (parentEventSubject) {
			this.parentEventSubject = parentEventSubject;
		}
		this.addToParent();
	}

	/**
	 * 添加单个事件订阅。
	 * @param target   回调绑定的对象（回调内 this 指向它）
	 * @param eventKey 事件名
	 * @param callBack 回调函数，默认空函数
	 *
	 * @remarks
	 * 重复订阅（同 target 且同 callBack 且同 eventKey）会被去重，只保留一份。
	 */
	onEvent(target: any, eventKey: string, callBack: Function = () => {}): void {
		this.add(eventKey, target, callBack);
	}

	/**
	 * 添加单个事件（内部实现）。
	 * @param eventKey 事件名
	 * @param target   回调绑定对象
	 * @param callBack 回调函数
	 *
	 * @remarks
	 * 去重规则：同 eventKey 下，若已存在 target 与 callBack 都相同的项，则直接返回。
	 * 复杂度：O(n)，n 为该事件名现有绑定数。
	 */
	private add(eventKey: string, target: any, callBack: Function): void {
		let callBacks = this.bindFunction.get(eventKey);
		if (!callBacks) {
			callBacks = [];
			this.bindFunction.set(eventKey, callBacks);
		}
		// 去重：同 target 同 callBack 只保留一份
		for (let i = 0; i < callBacks.length; i++) {
			const item = callBacks[i];
			if (item.callBack === callBack && item.target === target) return;
		}
		callBacks.push({ target, callBack });
	}

	/**
	 * 添加多个事件订阅。
	 * 每次调用会创建一个子观察者（parent 为当前实例），
	 * 所有订阅挂在该子观察者上，便于后续整体销毁。
	 *
	 * @param target 所有回调统一绑定的对象
	 * @param obj    订阅描述数组，每项含 evnetKey（历史拼写）与 callBack
	 * @returns      新建的子观察者，可对其调用 destroy 一次性解除这批订阅
	 *
	 * @example
	 *  const sub = observer.onEvents(this, [
	 *    { evnetKey: "gold", callBack: this.onGold },
	 *    { evnetKey: "level", callBack: this.onLevel },
	 *  ]);
	 *  // 之后整体销毁：
	 *  sub.destroy();
	 */
	onEvents(target: any, obj: Array<EventBindDesc>): EventObserver;
	onEvents(target: any, obj: Array<EventBindDesc>): EventObserver {
		const eventObserver = new EventObserver(this);
		for (let i = 0; i < obj.length; i++) {
			const item = obj[i];
			eventObserver.onEvent(target, item.evnetKey, item.callBack);
		}
		return eventObserver;
	}

	/**
	 * 移除单个事件订阅。
	 * @param target   回调绑定对象
	 * @param eventKey 事件名
	 * @param callBack 回调函数
	 *
	 * @remarks 实际逻辑委托 remove；若该事件名不存在会 console.warn。
	 */
	offEvent(target: any, eventKey: string, callBack: Function): void {
		this.remove(target, eventKey, callBack);
	}

	/**
	 * 移除订阅（内部实现）。
	 * @param target   回调绑定对象
	 * @param eventKey 事件名
	 * @param callBack 回调函数；不传则清除该事件名下的全部绑定
	 *
	 * @remarks
	 * - 事件名不存在：console.warn 后返回。
	 * - 未传 callBack：直接删除整个事件名的绑定表。
	 * - 传了 callBack：仅移除 target 与 callBack 同时匹配的项，保留其余。
	 *   注意保留条件是 !(callBack === 且 target ===)，两者同时相等才删除。
	 */
	private remove(target: any, eventKey: string, callBack: Function): void {
		const callBacks = this.bindFunction.get(eventKey);
		if (!callBacks) {
			console.warn("没有找到事件", eventKey);
			return;
		}
		if (!callBack) {
			// 未传 callBack：清除该事件全部绑定
			this.bindFunction.delete(eventKey);
			return;
		}
		// 仅移除 target 与 callBack 同时匹配的项（保留其余）
		const filtered = callBacks.filter(item => !(item.callBack === callBack && item.target === target));
		if (filtered.length > 0) {
			this.bindFunction.set(eventKey, filtered);
		} else {
			this.bindFunction.delete(eventKey);
		}
	}

	/**
	 * 批量移除订阅。
	 * @param events 数组，每项含 eventKey / callBack / target
	 *
	 * @remarks 逐项调用 remove；任一项事件名不存在会 console.warn，不中断后续项。
	 */
	offEvents(events: Array<{ eventKey: string; callBack: Function; target: any }>): void {
		for (let i = 0; i < events.length; i++) {
			const item = events[i];
			this.remove(item.target, item.eventKey, item.callBack);
		}
	}

	/**
	 * 移除指定 target 的所有事件（递归到子观察者）。
	 * @param target 要清理的回调绑定对象
	 *
	 * @remarks
	 * 遍历当前 bindFunction，删除所有 item.target === target 的项；
	 * 某事件名删空后从 Map 中移除该 key。
	 * 随后对每个子观察者递归执行同样清理。
	 * 常用于对象销毁时统一解绑，避免回调悬挂。
	 */
	removeEventsByTarget(target: any): void {
		// 原地清理，避免新建 Map 的一次性开销
		for (const [key, callBacks] of this.bindFunction) {
			const filtered = callBacks.filter(item => item.target !== target);
			if (filtered.length === 0) {
				this.bindFunction.delete(key);
			} else if (filtered.length !== callBacks.length) {
				this.bindFunction.set(key, filtered);
			}
		}

		const subs = this.subEventSubjects;
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
	 * @param arg      透传给回调的参数，可多个
	 *
	 * @remarks
	 * 先收集所有匹配的 BindItem 到临时数组，再统一回调。
	 * 这样即使某个回调内部增删订阅，也不会影响本次遍历的稳定性
	 * （新增的绑定不会在本轮被触发，删除的绑定仍会按收集时的快照执行）。
	 */
	notification(eventKey: string, ...arg: any[]): void {
		// 收集完成后统一回调，避免回调中修改绑定表导致遍历错误
		const notificationArray: BindItem[] = [];
		this.findBindFunctionByEventKey(eventKey, notificationArray);
		for (let i = 0; i < notificationArray.length; i++) {
			const item = notificationArray[i];
			item.callBack.call(item.target, ...arg);
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
	 * 销毁当前观察者及其所有子观察者。
	 *
	 * @remarks
	 * 1. 从父级子列表移除自己；
	 * 2. parentEventSubject 置 null；
	 * 3. 递归销毁所有子观察者；
	 * 4. 清空子列表与绑定表。
	 *
	 * 销毁后实例不应再使用；如需复用请重新 new。
	 * 与 reset 不同，destroy 不可逆。
	 */
	destroy(): void {
		this.removeFromParent(this);
		this.parentEventSubject = null;
		const subs = this.subEventSubjects;
		for (let i = 0; i < subs.length; i++) {
			subs[i].destroy();
		}
		this.subEventSubjects.length = 0;
		this.bindFunction.clear();
	}
}

/**
 * 基础代理类：封装数据，支持事件通知。
 * - 对象类型：按属性逐 key 比较，变化的 key 发通知（事件名 = key）。
 * - 基础类型：直接通知 "value"。
 * 作为 BaseData / ObjectData 的公共父类，不直接对外使用。
 */
class SuperData<T> extends EventObserver {
	/** 当前封装的值 */
	protected value: T;

	/**
	 * @param data 初始值
	 */
	constructor(data: T) {
		super();
		this.value = data;
	}

	/**
	 * 整体替换值，并按差异发通知。
	 * - v 为 null/undefined：仅更新值，不发通知。
	 * - v 为对象：逐 key 与旧值比较，变化的 key 发通知。
	 * - v 为基础类型：与旧值不同则发 "value" 通知。
	 * @param v 新值
	 */
	setInfo(v: T): void {
		const oldValue = this.value;
		this.value = v;
		if (v == null) return;
		if (typeof v === "object") {
			for (const key in v) {
				if (oldValue && oldValue[key] === v[key]) continue;
				this.notification(key, v[key]);
			}
		} else {
			if (oldValue === v) return;
			this.notification("value", v);
		}
	}

	/** 读取当前值（只读视图，调用方不应直接修改） */
	getInfo(): Readonly<T> {
		return this.value;
	}

	/** 销毁：先走 EventObserver 清理订阅，再清空值 */
	destroy(): void {
		super.destroy();
		this.value = null as unknown as T;
	}
}

/**
 * 代理对象：引用类型数据模型。
 * 支持按属性 key 的通知（事件名 = 属性名）。
 */
export class ObjectData<T extends object> extends SuperData<T> {
	/**
	 * @param data 初始对象
	 */
	constructor(data: T) {
		super(data);
		this.value = data;
	}

	/**
	 * 设置对象某属性；与旧值相同则忽略，不同则更新并通知该 key。
	 * @param k 属性名
	 * @param v 新值
	 */
	set<K extends keyof T>(k: K, v: T[K]): void {
		if (this.value[k] === v) return;
		this.value[k] = v;
		this.notification(k as string, v);
	}

	/**
	 * 读取对象某属性。
	 * @param k 属性名
	 */
	get<K extends keyof T>(k: K): T[K] {
		return this.value[k];
	}

	/**
	 * 订阅某属性变更，并立即推送一次当前值。
	 * @param eventKey 属性名
	 * @param callBack 值变更回调
	 * @param target   回调绑定对象（回调内 this）
	 *
	 * @remarks
	 * 订阅后立即通知当前属性值，便于调用方初始化 UI 等。
	 */
	onValue<K extends keyof T>(eventKey: K, callBack: (v: T[K]) => void, target: any): void {
		const keyStr = String(eventKey);
		this.onEvent(target, keyStr, callBack);
		this.notification(keyStr, this.value[eventKey]);
	}
}
