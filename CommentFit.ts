import { CustomCCUtils } from "../utils/CustomCCUtils";

const { ccclass, property, disallowMultiple, executeInEditMode } = cc._decorator;
export enum CommentFitModel {
	NONE,
	/**
	 * 改变宽高来适配(响应式)
	 * 需要组件内部适配
	 */
	RESIZE,
	/**
	 * 改变scale来适配(保持宽高比)
	 * 不需要组件内部适配
	 */
	SCALE,
}
@ccclass
@disallowMultiple
@executeInEditMode
export default class CommentFit extends cc.Component {
	@property({ visible: false })
	private _model: CommentFitModel = CommentFitModel.NONE;
	set model(value: CommentFitModel) {
		if (value == this._model) {
			return;
		}
		this._model = value;
		this.updateFit();
	}
	@property({
		type: cc.Enum(CommentFitModel),
		tooltip: `适配模式
        1 RESIZE  改变宽高来适配(响应式),组件内部需要支持响应式
        2 SCALE 改变scale来适配(保持宽高比)`,
		displayName: "适配模式",
	})
	get model(): CommentFitModel {
		return this._model;
	}

	@property({ visible: false })
	private _size: cc.Size = cc.size(0, 0);
	set size(value: cc.Size) {
		if (value.equals(this._size)) {
			return;
		}
		this._size = value;
		this.updateFit();
	}
	@property({ displayName: "设计size" })
	get size(): cc.Size {
		return this._size.clone();
	}

	@property({ visible: false })
	private _scale: cc.Vec2 = cc.v2(0, 0);
	set scale(value: cc.Vec2) {
		if (value.equals(this._scale)) {
			return;
		}
		this._scale = value;
		this.updateFit();
	}
	@property({ displayName: "设计scale" })
	get scale(): cc.Vec2 {
		return this._scale.clone();
	}

	private canvasSize = cc.size(1920, 1080);
	// LIFE-CYCLE CALLBACKS:

	onLoad() {
		if (!this.scale.x && !this.scale.y) {
			this.scale = this.node.getScale(this.scale);
		}
		if (!this.size.width && !this.size.height) {
			this.size = this.node.getContentSize();
		}
		this.node.removeComponent(cc.Widget);
		this.node.parent.on(cc.Node.EventType.SIZE_CHANGED, this.updateFit, this);
		this.node.parent.on(cc.Node.EventType.ANCHOR_CHANGED, this.updatePosition, this);
		this.node.on(cc.Node.EventType.ANCHOR_CHANGED, this.updatePosition, this);
		if (CC_EDITOR) {
			//编辑器环境下修改节点size,scale，视为修改设计size,scale
			this.node.on(cc.Node.EventType.SIZE_CHANGED, this.sizeChange, this);
			this.node.on(cc.Node.EventType.SCALE_CHANGED, this.scaleChange, this);
		}
	}
	protected onEnable(): void {
		this.updateFit();
	}
	private sizeChange() {
		this.size = this.node.getContentSize();
	}
	private scaleChange() {
		this.scale = this.node.getScale(this.scale);
	}
	private updateFit() {
		switch (this.model) {
			case CommentFitModel.RESIZE:
				this.resizeFit();
				break;
			case CommentFitModel.SCALE:
				this.scaleFit();
				break;
		}
	}
	private resizeFit() {
		let parentSize = this.node.parent.getContentSize();
		if (CC_EDITOR && this.node.parent.name == "New Node" && !this.node.parent.parent) {
			// 编辑器模式下的默认尺寸
			parentSize = cc.size(this.size.width * this.scale.x, this.size.height * this.scale.y); //编辑器环境下就不适配到最大了
		}
		//还原成设计scale
		if (CC_EDITOR) {
			this.node.off(cc.Node.EventType.SCALE_CHANGED, this.scaleChange, this);
			this.node.setScale(this.scale);
			this.node.on(cc.Node.EventType.SCALE_CHANGED, this.scaleChange, this);
		} else {
			this.node.setScale(this.scale);
		}
		this.node.setContentSize(parentSize.width / this.scale.x, parentSize.height / this.scale.y);
		//刷新子节点布局
		if (!CC_EDITOR) {
			this.updateWidgetAlignmentsInChildren(this.node);
		}
		this.updatePosition();
	}
	private scaleFit() {
		let parentSize = this.node.parent.getContentSize();
		let selfSize = cc.size(this.size.width * this.scale.x, this.size.height * this.scale.y);
		if (CC_EDITOR && this.node.parent.name == "New Node" && !this.node.parent.parent) {
			parentSize = this.canvasSize;
		}
		//还原成设计size
		if (CC_EDITOR) {
			this.node.off(cc.Node.EventType.SIZE_CHANGED, this.sizeChange, this);
			this.node.setContentSize(this.size);
			this.node.on(cc.Node.EventType.SIZE_CHANGED, this.sizeChange, this);
		} else {
			this.node.setContentSize(this.size);
		}
		let scale = Math.min(parentSize.width / selfSize.width, parentSize.height / selfSize.height);
		this.node.scaleX = this.scale.x * scale;
		this.node.scaleY = this.scale.y * scale;
		this.updatePosition();
	}
	private updatePosition() {
		let parentSize = this.node.parent.getContentSize();
		if (CC_EDITOR && this.node.parent.name == "New Node" && !this.node.parent.parent) {
			parentSize = this.canvasSize;
		}
		const selfSize = this.node.getContentSize();
		const selfScale = cc.v2(this.node.scaleX, this.node.scaleY);
		const parentAnchor = this.node.parent.getAnchorPoint();
		const nodeAnchor = this.node.getAnchorPoint();
		const x = parentSize.width * (0.5 - parentAnchor.x) - selfSize.width * selfScale.x * (0.5 - nodeAnchor.x);
		const y = parentSize.height * (0.5 - parentAnchor.y) - selfSize.height * selfScale.y * (0.5 - nodeAnchor.y);
		this.node.setPosition(x, y);
	}

	/** 刷新一个节点所有的受影响的子节点的widget
	 * @param curNode 变动的节点
	 */
	updateWidgetAlignmentsInChildren(curNode: cc.Node) {
		let TOP = 1 << 0;
		let MID = 1 << 1; // vertical center
		let BOT = 1 << 2;
		let LEFT = 1 << 3;
		let CENTER = 1 << 4; // horizontal center
		let RIGHT = 1 << 5;
		let HORIZONTAL = LEFT | CENTER | RIGHT;
		let VERTICAL = TOP | MID | BOT;
		let stack: cc.Node[] = [curNode];
		while (stack.length) {
			let parent = stack.pop();
			parent.children.forEach(arrI => {
				let widget = arrI.getComponent(cc.Widget);
				if (widget) {
					let node = widget.node;
					let hasTarget = widget.target;
					let target: cc.Node;
					let inverseTranslate: cc.Vec2, inverseScale: cc.Vec2;
					if (hasTarget) {
						target = hasTarget;
						inverseTranslate = cc.Vec2.ZERO;
						inverseScale = cc.Vec2.ONE;
						let scaleX = node.parent.scaleX;
						let scaleY = node.parent.scaleY;
						let translateX = 0;
						let translateY = 0;
						for (let tempNode = node.parent; ; ) {
							translateX += tempNode.x;
							translateY += tempNode.y;
							tempNode = tempNode.parent; // loop increment
							if (!tempNode) {
								// ERROR: widgetNode should be child of target
								inverseTranslate.x = inverseTranslate.y = 0;
								inverseScale.x = inverseScale.y = 1;
								return;
							}
							if (tempNode !== target) {
								let sx = tempNode.scaleX;
								let sy = tempNode.scaleY;
								translateX *= sx;
								translateY *= sy;
								scaleX *= sx;
								scaleY *= sy;
							} else {
								break;
							}
						}
						inverseScale.x = scaleX !== 0 ? 1 / scaleX : 1;
						inverseScale.y = scaleY !== 0 ? 1 / scaleY : 1;
						inverseTranslate.x = -translateX;
						inverseTranslate.y = -translateY;
					} else {
						target = node.parent;
					}
					let targetSize: { width: number; height: number };
					if (target instanceof cc.Scene) {
						targetSize = cc.visibleRect;
					} else {
						targetSize = target.getContentSize();
					}
					let targetAnchor = target.getAnchorPoint();

					let isRoot = !CC_EDITOR && target instanceof cc.Scene;
					let x = node.x,
						y = node.y;
					let anchor = node.getAnchorPoint();

					if (widget["_alignFlags"] & HORIZONTAL) {
						let localLeft: number,
							localRight: number,
							targetWidth = targetSize.width;
						if (isRoot) {
							localLeft = cc.visibleRect.left.x;
							localRight = cc.visibleRect.right.x;
						} else {
							localLeft = -targetAnchor.x * targetWidth;
							localRight = localLeft + targetWidth;
						}

						// adjust borders according to offsets
						localLeft += widget.isAbsoluteLeft ? widget.left : widget.left * targetWidth;
						localRight -= widget.isAbsoluteRight ? widget.right : widget.right * targetWidth;

						if (hasTarget) {
							localLeft += inverseTranslate.x;
							localLeft *= inverseScale.x;
							localRight += inverseTranslate.x;
							localRight *= inverseScale.x;
						}

						let width: number,
							anchorX = anchor.x,
							scaleX = node.scaleX;
						if (scaleX < 0) {
							anchorX = 1.0 - anchorX;
							scaleX = -scaleX;
						}
						if (widget.isStretchWidth) {
							width = localRight - localLeft;
							if (scaleX !== 0) {
								node.width = width / scaleX;
							}
							x = localLeft + anchorX * width;
						} else {
							width = node.width * scaleX;
							if (widget.isAlignHorizontalCenter) {
								let localHorizontalCenter = widget.isAbsoluteHorizontalCenter
									? widget.horizontalCenter
									: widget.horizontalCenter * targetWidth;
								let targetCenter = (0.5 - targetAnchor.x) * targetSize.width;
								if (hasTarget) {
									localHorizontalCenter *= inverseScale.x;
									targetCenter += inverseTranslate.x;
									targetCenter *= inverseScale.x;
								}
								x = targetCenter + (anchorX - 0.5) * width + localHorizontalCenter;
							} else if (widget.isAlignLeft) {
								x = localLeft + anchorX * width;
							} else {
								x = localRight + (anchorX - 1) * width;
							}
						}
					}
					if (widget["_alignFlags"] & VERTICAL) {
						let localTop: number,
							localBottom: number,
							targetHeight = targetSize.height;
						if (isRoot) {
							localBottom = cc.visibleRect.bottom.y;
							localTop = cc.visibleRect.top.y;
						} else {
							localBottom = -targetAnchor.y * targetHeight;
							localTop = localBottom + targetHeight;
						}

						// adjust borders according to offsets
						localBottom += widget.isAbsoluteBottom ? widget.bottom : widget.bottom * targetHeight;
						localTop -= widget.isAbsoluteTop ? widget.top : widget.top * targetHeight;

						if (hasTarget) {
							// transform
							localBottom += inverseTranslate.y;
							localBottom *= inverseScale.y;
							localTop += inverseTranslate.y;
							localTop *= inverseScale.y;
						}

						let height: number,
							anchorY = anchor.y,
							scaleY = node.scaleY;
						if (scaleY < 0) {
							anchorY = 1.0 - anchorY;
							scaleY = -scaleY;
						}
						if (widget.isStretchHeight) {
							height = localTop - localBottom;
							if (scaleY !== 0) {
								node.height = height / scaleY;
							}
							y = localBottom + anchorY * height;
						} else {
							height = node.height * scaleY;
							if (widget.isAlignVerticalCenter) {
								let localVerticalCenter = widget.isAbsoluteVerticalCenter
									? widget.verticalCenter
									: widget.verticalCenter * targetHeight;
								let targetMiddle = (0.5 - targetAnchor.y) * targetSize.height;
								if (hasTarget) {
									localVerticalCenter *= inverseScale.y;
									targetMiddle += inverseTranslate.y;
									targetMiddle *= inverseScale.y;
								}
								y = targetMiddle + (anchorY - 0.5) * height + localVerticalCenter;
							} else if (widget.isAlignBottom) {
								y = localBottom + anchorY * height;
							} else {
								y = localTop + (anchorY - 1) * height;
							}
						}
					}
					node.setPosition(x, y);
					stack.push(node);
				}
			});
		}
	}
	// update (dt) {}1
}
