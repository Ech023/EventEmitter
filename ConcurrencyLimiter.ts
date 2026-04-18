/**
 * 异步信号量（核心：控制异步任务的并发数量）
 * 适用场景：接口请求并发限制、批量文件上传、异步任务队列
 * 原理：通过「令牌池」实现限流 —— 令牌数量 = 最大并发数
 * @example 
 *      const Limiter = new ConcurrencyLimiter(8);
		const doTask = async (taskId: number) => {
			await Limiter.request();
			try {
				await new Promise(resolve => {
					const delay = Math.random() * 3000;
					setTimeout(resolve, delay);
				});
				Limiter.release();
			} catch (err) {
				console.error(err);
				throw err;
			}
		};
		const taskList: Promise<void>[] = [];
		for (let i = 1; i <= 100; i++) {
			taskList.release(doTask(i));
		}
		await Promise.all(taskList);
		await Limiter.waitForAll();
 */
export class ConcurrencyLimiter {
	/**
	 * 等待队列
	 * 存储：所有暂时拿不到令牌、需要等待的任务「resolve函数」
	 * 释放令牌时，从队列头部取出一个任务唤醒执行
	 */
	private _tasks: ((value: void | PromiseLike<void>) => void)[] = [];
	/**
	 * 当前【可用令牌数】 用户控制是否还能开启新的并发
	 * 获取令牌 request() → _count -1
	 * 释放令牌 release() → _count +1
	 */
	private _count: number;
	/**
	 * 最大并发执行数 = 总令牌数
	 * 构造时传入，永不改变
	 */
	private _maxCount: number;

	/**
	 * 构造函数：初始化信号量
	 * @param _maxCount 最大并发数（必须 ≥ 1）
	 */
	constructor(_maxCount: number) {
		this._tasks = [];
		if (_maxCount < 1) _maxCount = 1;
		this._maxCount = _maxCount;
		this._count = _maxCount;
	}

	/**
	 * 获取令牌（任务执行前必须调用）
	 * 逻辑：
	 * 1. 有令牌 → 直接占用，继续执行
	 * 2. 无令牌 → 进入等待队列，阻塞异步流程
	 * @returns Promise<void> 拿到令牌后才会 resolve
	 */
	async request(): Promise<void> {
		if (this._count > 0) {
			this._count--;
			return Promise.resolve();
		}
		return new Promise<void>(resolve => {
			this._tasks.push(resolve);
		});
	}

	/**
	 * 释放令牌（任务执行完必须调用）
	 * 逻辑：
	 * 1. 有等待任务 → 唤醒队列第一个任务（不归还令牌）
	 * 2. 无等待任务 → 归还令牌，恢复可用数量
	 */
	release(): void {
		const next = this._tasks.shift();
		if (next) {
			next();
		} else {
			if (this._count < this._maxCount) {
				this._count++;
			}
		}
	}

	/**
	 * 等待【所有任务】全部执行完毕
	 * 满足两个条件才会完成：
	 * 1. 等待队列清空（无排队任务）
	 * 2. 所有令牌都已归还（count === maxCount）
	 * @returns Promise<void>
	 */
	waitForAll(): Promise<void> {
		return new Promise(resolve => {
			const check = () => {
				if (this._tasks.length === 0 && this._count === this._maxCount) {
					resolve();
				} else {
					this._tasks.push(() => check());
				}
			};
			check();
		});
	}
	/** 获取任务的相关数据 */
	requestListInfo() {
		return {
			waitLen: this._tasks.length,
			canRun: this._count,
			maxCount: this._maxCount,
		};
	}
}
