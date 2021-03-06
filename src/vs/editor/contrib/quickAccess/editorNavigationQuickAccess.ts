/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IQuickAccessProvider } from 'vs/platform/quickinput/common/quickAccess';
import { IEditor, ScrollType, IDiffEditor } from 'vs/editor/common/editorCommon';
import { IModelDeltaDecoration, OverviewRulerLane, ITextModel } from 'vs/editor/common/model';
import { IRange } from 'vs/editor/common/core/range';
import { themeColorFromId } from 'vs/platform/theme/common/themeService';
import { overviewRulerRangeHighlight } from 'vs/editor/common/view/editorColorRegistry';
import { IQuickPick, IQuickPickItem, IKeyMods } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IDisposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { isDiffEditor } from 'vs/editor/browser/editorBrowser';
import { withNullAsUndefined } from 'vs/base/common/types';
import { once } from 'vs/base/common/functional';

interface IEditorLineDecoration {
	rangeHighlightId: string;
	overviewRulerDecorationId: string;
}

/**
 * A reusable quick access provider for the editor with support
 * for adding decorations for navigating in the currently active file
 * (for example "Go to line", "Go to symbol").
 */
export abstract class AbstractEditorNavigationQuickAccessProvider implements IQuickAccessProvider {

	//#region Provider methods

	provide(picker: IQuickPick<IQuickPickItem>, token: CancellationToken): IDisposable {
		const disposables = new DisposableStore();

		// Disable filtering & sorting, we control the results
		picker.matchOnLabel = picker.matchOnDescription = picker.matchOnDetail = picker.sortByLabel = false;

		// Provide based on current active editor
		let pickerDisposable = this.doProvide(picker, token);
		disposables.add(toDisposable(() => pickerDisposable.dispose()));

		// Re-create whenever the active editor changes
		disposables.add(this.onDidActiveTextEditorControlChange(() => {
			pickerDisposable.dispose();
			pickerDisposable = this.doProvide(picker, token);
		}));

		return disposables;
	}

	private doProvide(picker: IQuickPick<IQuickPickItem>, token: CancellationToken): IDisposable {
		const disposables = new DisposableStore();

		// With text control
		const editor = this.activeTextEditorControl;
		if (editor && this.canProvideWithTextEditor(editor)) {

			// Restore any view state if this picker was closed
			// without actually going to a line
			const lastKnownEditorViewState = withNullAsUndefined(editor.saveViewState());
			once(token.onCancellationRequested)(() => {
				if (lastKnownEditorViewState) {
					editor.restoreViewState(lastKnownEditorViewState);
				}
			});

			// Clean up decorations on dispose
			disposables.add(toDisposable(() => this.clearDecorations(editor)));

			// Ask subclass for entries
			disposables.add(this.provideWithTextEditor(editor, picker, token));
		}

		// Without text control
		else {
			disposables.add(this.provideWithoutTextEditor(picker, token));
		}

		return disposables;
	}

	/**
	 * Subclasses to implement if they can operate on the text editor.
	 */
	protected canProvideWithTextEditor(editor: IEditor): boolean {
		return true;
	}

	/**
	 * Subclasses to implement to provide picks for the picker when an editor is active.
	 */
	protected abstract provideWithTextEditor(editor: IEditor, picker: IQuickPick<IQuickPickItem>, token: CancellationToken): IDisposable;

	/**
	 * Subclasses to implement to provide picks for the picker when no editor is active.
	 */
	protected abstract provideWithoutTextEditor(picker: IQuickPick<IQuickPickItem>, token: CancellationToken): IDisposable;

	protected gotoLocation(editor: IEditor, range: IRange, keyMods: IKeyMods, forceSideBySide?: boolean): void {
		editor.setSelection(range);
		editor.revealRangeInCenter(range, ScrollType.Smooth);
		editor.focus();
	}

	protected getModel(editor: IEditor | IDiffEditor): ITextModel | undefined {
		return isDiffEditor(editor) ?
			editor.getModel()?.modified :
			editor.getModel() as ITextModel;
	}

	//#endregion


	//#region Editor access

	/**
	 * Subclasses to provide an event when the active editor control changes.
	 */
	protected abstract readonly onDidActiveTextEditorControlChange: Event<void>;

	/**
	 * Subclasses to provide the current active editor control.
	 */
	protected abstract activeTextEditorControl: IEditor | undefined;

	//#endregion


	//#region Decorations Utils

	private rangeHighlightDecorationId: IEditorLineDecoration | undefined = undefined;

	protected addDecorations(editor: IEditor, range: IRange): void {
		editor.changeDecorations(changeAccessor => {

			// Reset old decorations if any
			const deleteDecorations: string[] = [];
			if (this.rangeHighlightDecorationId) {
				deleteDecorations.push(this.rangeHighlightDecorationId.overviewRulerDecorationId);
				deleteDecorations.push(this.rangeHighlightDecorationId.rangeHighlightId);

				this.rangeHighlightDecorationId = undefined;
			}

			// Add new decorations for the range
			const newDecorations: IModelDeltaDecoration[] = [

				// highlight the entire line on the range
				{
					range,
					options: {
						className: 'rangeHighlight',
						isWholeLine: true
					}
				},

				// also add overview ruler highlight
				{
					range,
					options: {
						overviewRuler: {
							color: themeColorFromId(overviewRulerRangeHighlight),
							position: OverviewRulerLane.Full
						}
					}
				}
			];

			const [rangeHighlightId, overviewRulerDecorationId] = changeAccessor.deltaDecorations(deleteDecorations, newDecorations);

			this.rangeHighlightDecorationId = { rangeHighlightId, overviewRulerDecorationId };
		});
	}

	protected clearDecorations(editor: IEditor): void {
		const rangeHighlightDecorationId = this.rangeHighlightDecorationId;
		if (rangeHighlightDecorationId) {
			editor.changeDecorations(changeAccessor => {
				changeAccessor.deltaDecorations([
					rangeHighlightDecorationId.overviewRulerDecorationId,
					rangeHighlightDecorationId.rangeHighlightId
				], []);
			});

			this.rangeHighlightDecorationId = undefined;
		}
	}

	//#endregion
}
