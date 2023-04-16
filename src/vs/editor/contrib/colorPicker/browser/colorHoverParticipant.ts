/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Color, RGBA } from 'vs/base/common/color';
import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { Range } from 'vs/editor/common/core/range';
import { IModelDecoration, ITextModel, TrackedRangeStickiness } from 'vs/editor/common/model';
import { DocumentColorProvider, IColorInformation } from 'vs/editor/common/languages';
import { getColorPresentations, getColors } from 'vs/editor/contrib/colorPicker/browser/color';
import { ColorDetector } from 'vs/editor/contrib/colorPicker/browser/colorDetector';
import { ColorPickerModel } from 'vs/editor/contrib/colorPicker/browser/colorPickerModel';
import { ColorPickerWidget } from 'vs/editor/contrib/colorPicker/browser/colorPickerWidget';
import { HoverAnchor, HoverAnchorType, IEditorHoverParticipant, IEditorHoverRenderContext, IHoverPart } from 'vs/editor/contrib/hover/browser/hoverTypes';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ISingleEditOperation } from 'vs/editor/common/core/editOperation';
import { LanguageFeatureRegistry } from 'vs/editor/common/languageFeatureRegistry';

export class ColorHover implements IHoverPart {

	/**
	 * Force the hover to always be rendered at this specific range,
	 * even in the case of multiple hover parts.
	 */
	public readonly forceShowAtRange: boolean = true;

	constructor(
		public readonly owner: IEditorHoverParticipant<ColorHover>,
		public readonly range: Range,
		public readonly model: ColorPickerModel,
		public readonly provider: DocumentColorProvider
	) { }

	public isValidForHoverAnchor(anchor: HoverAnchor): boolean {
		return (
			anchor.type === HoverAnchorType.Range
			&& this.range.startColumn <= anchor.range.startColumn
			&& this.range.endColumn >= anchor.range.endColumn
		);
	}
}

export class ColorHoverParticipant implements IEditorHoverParticipant<ColorHover> {

	public readonly hoverOrdinal: number = 2;

	constructor(
		private readonly _editor: ICodeEditor,
		@IThemeService private readonly _themeService: IThemeService,
	) { }

	public computeSync(anchor: HoverAnchor, lineDecorations: IModelDecoration[]): ColorHover[] {
		return [];
	}

	public computeAsync(anchor: HoverAnchor, lineDecorations: IModelDecoration[], token: CancellationToken): AsyncIterableObject<ColorHover> {
		return AsyncIterableObject.fromPromise(this._computeAsync(anchor, lineDecorations, token));
	}

	private async _computeAsync(_anchor: HoverAnchor, lineDecorations: IModelDecoration[], token: CancellationToken): Promise<ColorHover[]> {
		if (!this._editor.hasModel()) {
			return [];
		}
		const colorDetector = ColorDetector.get(this._editor);
		if (!colorDetector) {
			return [];
		}
		for (const d of lineDecorations) {
			if (!colorDetector.isColorDecoration(d)) {
				continue;
			}

			const colorData = colorDetector.getColorData(d.range.getStartPosition());
			if (colorData) {
				const colorHover = await _createColorHover(this, this._editor.getModel(), colorData.colorInfo, colorData.provider);
				return [colorHover];
			}

		}
		return [];
	}

	public renderHoverParts(context: IEditorHoverRenderContext, hoverParts: ColorHover[]): IDisposable {
		return renderHoverParts(this, this._editor, this._themeService, hoverParts, context);
	}
}

export class StandaloneColorPickerHover {
	constructor(
		public readonly owner: StandaloneColorPickerParticipant,
		public readonly range: Range,
		public readonly model: ColorPickerModel,
		public readonly provider: DocumentColorProvider
	) { }
}

// Not extending the IEditorHover participant, because is not be used in the hover
// Shares common code however with the ColorHoverParticipant, hence placed here
export class StandaloneColorPickerParticipant {

	public readonly hoverOrdinal: number = 2;
	private _range: Range | null = null;
	private _color: Color | null = null;

	constructor(
		private readonly _editor: ICodeEditor,
		@IThemeService private readonly _themeService: IThemeService,
	) { }

	public async createColorHover(defaultColorInfo: IColorInformation, colorProviderRegistry: LanguageFeatureRegistry<DocumentColorProvider>, defaultColorProvider: DocumentColorProvider): Promise<{ colorHover: StandaloneColorPickerHover; foundInEditor: boolean } | null> {
		// return createColorHover(this, this._editor, colorInfo, colorProviderRegistry, defaultColorProvider);

		console.log('Inside of createColorHover');
		if (!this._editor.hasModel()) {
			return null;
		}
		const colorDetector = ColorDetector.get(this._editor);
		if (!colorDetector) {
			return null;
		}
		// TODO: compute the color ranges here and see if there are any colors, otherwise just return the default color info
		// Computing all the color datas anew, because need to know the colors and their ranges in order to be decide wether to use default or not
		// Using the genenric getColors method

		// Directly get the colors from the getColors function
		const colors = await getColors(colorProviderRegistry, this._editor.getModel(), CancellationToken.None);
		console.log('colors : ', colors);
		// Verify if among the obtained colors, we find a color for the range we asked for
		let foundColorInfo: IColorInformation | null = null;
		let foundColorProvider: DocumentColorProvider | null = null;
		for (const colorData of colors.colorData) {
			const colorInfo = colorData.colorInfo;
			console.log('colorInfo.range : ', colorInfo.range);
			console.log('defaultColorInfo.range : ', defaultColorInfo.range);
			// Not checking for equality, but checking that the current position is contained in another position
			if (colorInfo.range.startLineNumber === defaultColorInfo.range.startLineNumber
				&& defaultColorInfo.range.startColumn >= colorInfo.range.startColumn
				&& defaultColorInfo.range.endColumn <= colorInfo.range.endColumn) {
				// TODO: But this could be reassigned depending on if there are several providers giving information for the same range?
				// How to deal with the case when several color infos are used
				foundColorInfo = colorInfo;
				foundColorProvider = colorData.provider;
			}
		}
		// When the variable existingColorInfo has been assigned, then use this variable, otherwise use the default color information
		console.log('foundColorInfo : ', foundColorInfo);
		console.log('foundColorProvider : ', foundColorProvider);
		const colorInfo = foundColorInfo ? foundColorInfo : defaultColorInfo;
		const colorProvider = foundColorProvider ? foundColorProvider : defaultColorProvider;
		const foundInEditor = !!foundColorInfo;
		return { colorHover: await _createColorHover(this, this._editor.getModel(), colorInfo, colorProvider), foundInEditor: foundInEditor };
	}

	public renderHoverParts(context: IEditorHoverRenderContext, hoverParts: ColorHover[] | StandaloneColorPickerHover[]): IDisposable {
		return renderHoverParts(this, this._editor, this._themeService, hoverParts, context);
	}

	public updateEditorModel(colorHoverData: StandaloneColorPickerHover): void {
		updateEditorModel(this, this._editor, colorHoverData);
	}

	public set range(range: Range | null) {
		this._range = range;
	}

	public get range(): Range | null {
		return this._range;
	}

	public set color(color: Color | null) {
		this._color = color;
	}

	public get color(): Color | null {
		return this._color;
	}
}

async function _createColorHover<T extends ColorHoverParticipant | StandaloneColorPickerParticipant>(participant: T, editorModel: ITextModel, colorInfo: IColorInformation, provider: DocumentColorProvider): Promise<T extends ColorHoverParticipant ? ColorHover : StandaloneColorPickerHover>;
async function _createColorHover(participant: ColorHoverParticipant | StandaloneColorPickerParticipant, editorModel: ITextModel, colorInfo: IColorInformation, provider: DocumentColorProvider): Promise<ColorHover | StandaloneColorPickerHover> {
	const originalText = editorModel.getValueInRange(colorInfo.range);
	const { red, green, blue, alpha } = colorInfo.color;
	const rgba = new RGBA(Math.round(red * 255), Math.round(green * 255), Math.round(blue * 255), alpha);
	const color = new Color(rgba);

	// For the specific color info and the provider which has been chosen compute the color presentations
	const colorPresentations = await getColorPresentations(editorModel, colorInfo, provider, CancellationToken.None);
	const model = new ColorPickerModel(color, [], 0);
	model.colorPresentations = colorPresentations || [];
	model.guessColorPresentation(color, originalText);

	if (participant instanceof ColorHoverParticipant) {
		return new ColorHover(participant, Range.lift(colorInfo.range), model, provider);
	} else {
		return new StandaloneColorPickerHover(participant, Range.lift(colorInfo.range), model, provider);
	}
}

function renderHoverParts(participant: ColorHoverParticipant | StandaloneColorPickerParticipant, editor: ICodeEditor, themeService: IThemeService, hoverParts: ColorHover[] | StandaloneColorPickerHover[], context: IEditorHoverRenderContext) {
	if (hoverParts.length === 0 || !editor.hasModel()) {
		return Disposable.None;
	}

	const disposables = new DisposableStore();
	const colorHover = hoverParts[0];
	const editorModel = editor.getModel();
	const model = colorHover.model;
	const widget = disposables.add(new ColorPickerWidget(context.fragment, model, editor.getOption(EditorOption.pixelRatio), themeService, participant instanceof StandaloneColorPickerParticipant));
	context.setColorPicker(widget);

	let range = new Range(colorHover.range.startLineNumber, colorHover.range.startColumn, colorHover.range.endLineNumber, colorHover.range.endColumn);
	if (participant instanceof StandaloneColorPickerParticipant) {
		const color = hoverParts[0].model.color;
		participant.color = color;
		_updateColorPresentations(editorModel, model, color, range, colorHover);
		disposables.add(model.onColorFlushed((color: Color) => {
			participant.color = color;
		}));
	} else {
		disposables.add(model.onColorFlushed((color: Color) => {
			_updateColorPresentations(editorModel, model, color, range, colorHover).then(() => range = _updateEditorModel(participant, editor, range, model, context));
		}));
	}
	disposables.add(model.onDidChangeColor((color: Color) => { _updateColorPresentations(editorModel, model, color, range, colorHover); }));
	return disposables;
}

function updateEditorModel(participant: StandaloneColorPickerParticipant, editor: ICodeEditor, colorHover: StandaloneColorPickerHover): void {
	if (!editor.hasModel()) {
		return;
	}
	const colorPickerModel = colorHover.model;
	let range = new Range(colorHover.range.startLineNumber, colorHover.range.startColumn, colorHover.range.endLineNumber, colorHover.range.endColumn);
	if (participant.color) {
		_updateColorPresentations(editor.getModel(), colorPickerModel, participant.color, range, colorHover).then(() => range = _updateEditorModel(participant, editor, range, colorPickerModel));
	}
}

function _updateEditorModel(participant: ColorHoverParticipant | StandaloneColorPickerParticipant, editor: ICodeEditor, range: Range, model: ColorPickerModel, context?: IEditorHoverRenderContext) {
	let textEdits: ISingleEditOperation[];
	let newRange: Range;
	if (model.presentation.textEdit) {
		textEdits = [model.presentation.textEdit];
		newRange = participant instanceof StandaloneColorPickerParticipant && participant.range ?
			new Range(
				participant.range.startLineNumber,
				participant.range.startColumn,
				participant.range.endLineNumber,
				participant.range.endColumn
			) :
			new Range(
				model.presentation.textEdit.range.startLineNumber,
				model.presentation.textEdit.range.startColumn,
				model.presentation.textEdit.range.endLineNumber,
				model.presentation.textEdit.range.endColumn
			);
		const trackedRange = editor.getModel()!._setTrackedRange(null, newRange, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter);
		editor.pushUndoStop();
		editor.executeEdits('colorpicker', textEdits);
		newRange = editor.getModel()!._getTrackedRange(trackedRange) || newRange;
	} else {
		textEdits = [{ range, text: model.presentation.label, forceMoveMarkers: false }];
		newRange = range.setEndPosition(range.endLineNumber, range.startColumn + model.presentation.label.length);
		editor.pushUndoStop();
		editor.executeEdits('colorpicker', textEdits);
	}

	if (model.presentation.additionalTextEdits) {
		textEdits = [...model.presentation.additionalTextEdits];
		editor.executeEdits('colorpicker', textEdits);
		if (context) {
			context.hide();
		}
	}
	editor.pushUndoStop();
	return newRange;
}

function _updateColorPresentations(editorModel: ITextModel, colorPickerModel: ColorPickerModel, color: Color, range: Range, colorHover: ColorHover | StandaloneColorPickerHover) {
	return getColorPresentations(editorModel, {
		range: range,
		color: {
			red: color.rgba.r / 255,
			green: color.rgba.g / 255,
			blue: color.rgba.b / 255,
			alpha: color.rgba.a
		}
	}, colorHover.provider, CancellationToken.None).then((colorPresentations) => {
		colorPickerModel.colorPresentations = colorPresentations || [];
	});
}
