import * as typeInterfaces from './panesType';

let $;
let DataTable;

export function setJQuery(jq) {
  $ = jq;
  DataTable = jq.fn.dataTable;
}

namespace DataTables {
	interface IStaticFunctions {
		select: any;
	}
}
import SearchPane from './searchPane';
export default class SearchPanes {

	private static version = '1.0.1';

	private static classes: typeInterfaces.IClasses = {
		clear: 'dtsp-clear',
		clearAll: 'dtsp-clearAll',
		container: 'dtsp-searchPanes',
		emptyMessage: 'dtsp-emptyMessage',
		hide: 'dtsp-hidden',
		panes: 'dtsp-panesContainer',
		search: 'dtsp-search',
		title: 'dtsp-title',
		titleRow: 'dtsp-titleRow'
	};

	// Define SearchPanes default options
	private static defaults: typeInterfaces.IDefaults = {
		cascadePanes: false,
		clear: true,
		container(dt) {
			return dt.table().container();
		},
		columns: [],
		filterChanged: undefined,
		layout: 'columns-3',
		order: [],
		panes: [],
		viewTotal: false,
	};

	public classes: typeInterfaces.IClasses;
	public dom: typeInterfaces.IDOM;
	public c: typeInterfaces.IDefaults;
	public s: typeInterfaces.IS;
	public regenerating: boolean = false;

	constructor(paneSettings, opts, fromInit = false) {
		// Check that the required version of DataTables is included
		if (! DataTable || ! DataTable.versionCheck || ! DataTable.versionCheck('1.10.0')) {
			throw new Error('SearchPane requires DataTables 1.10 or newer');
		}

		// Check that Select is included
		if (! (DataTable as any).select) {
			throw new Error('SearchPane requires Select');
		}

		let table = new DataTable.Api(paneSettings);
		this.classes = $.extend(true, {}, SearchPanes.classes);

		// Get options from user
		this.c = $.extend(true, {}, SearchPanes.defaults, opts);

		// Add extra elements to DOM object including clear
		this.dom = {
			clearAll: $('<button type="button">Clear All</button>').addClass(this.classes.clearAll),
			container: $('<div/>').addClass(this.classes.panes).text(
				table.i18n('searchPanes.loadMessage', 'Loading Search Panes...')
			),
			emptyMessage: $('<div/>').addClass(this.classes.emptyMessage),
			options: $('<div/>').addClass(this.classes.container),
			panes: $('<div/>').addClass(this.classes.container),
			title: $('<div/>').addClass(this.classes.title),
			titleRow: $('<div/>').addClass(this.classes.titleRow),
			wrapper: $('<div/>'),
		};

		this.s = {
			colOpts: [],
			dt: table,
			filterPane: -1,
			panes: [],
			selectionList: [],
			serverData: {},
			updating: false,
		};

		if (table.settings()[0]._searchPanes !== undefined) {
			return;
		}
		// We are using the xhr event to rebuild the panes if required due to viewTotal being enabled
		// If viewTotal is not enabled then we simply update the data from the server
		table.on('xhr', (e, settings, json, xhr) => {
			if (json.searchPanes && json.searchPanes.options) {
				this.s.serverData = json.searchPanes.options;
				this.s.serverData.tableLength = json.recordsTotal;

				if (this.c.viewTotal  || this.c.cascadePanes) {
					this._serverTotals();
				}
			}
		});

		table.settings()[0]._searchPanes = this;
		this.dom.clearAll.text(table.i18n('searchPanes.clearMessage', 'Clear All'));

		this._getState();

		if (this.s.dt.settings()[0]._bInitComplete || fromInit) {
			this._paneDeclare(table, paneSettings, opts);
		}
		else {
			table.one('preInit.dt', (settings) => {
				this._paneDeclare(table, paneSettings, opts);
			});
		}
	}

	/**
	 * Clear the selections of all of the panes
	 */
	public clearSelections(): SearchPane[] {
		// Load in all of the searchBoxes in the documents
		let searches = this.dom.container.find(this.classes.search);

		// For each searchBox set the input text to be empty and then trigger
		//  an input on them so that they no longer filter the panes
		searches.each(function() {
			$(this).val('');
			$(this).trigger('input');
		});

		let returnArray: SearchPane[] = [];

		// For every pane, clear the selections in the pane
		for (let pane of this.s.panes) {
			if (pane.s.dtPane !== undefined) {
				returnArray.push(pane.clearPane());
			}
		}

		this.s.dt.draw();

		return returnArray;
	}

	/**
	 * returns the container node for the searchPanes
	 */
	public getNode(): JQuery<HTMLElement> {
		return this.dom.container;
	}

	/**
	 * rebuilds all of the panes
	 */
	public rebuild(targetIdx: boolean | number = false, maintainSelection = false): SearchPane | SearchPane[] {
		$(this.dom.emptyMessage).remove();
		// As a rebuild from scratch is required, empty the searchpanes container.
		let returnArray: SearchPane[] = [];

		// Rebuild each pane individually, if a specific pane has been selected then only rebuild that one
		$(this.dom.panes).empty();
		for (let pane of this.s.panes) {
			if (targetIdx !== false && pane.s.index !== targetIdx) {
				$(this.dom.panes).append(pane.dom.container);
				continue;
			}

			pane.clearData();
			returnArray.push(
				// Pass a boolean to say whether this is the last choice made for maintaining selections when rebuilding
				pane.rebuildPane(
					this.s.selectionList[this.s.selectionList.length - 1] !== undefined ?
						pane.s.index === this.s.selectionList[this.s.selectionList.length - 1].index :
						false,
					this.s.dt.page.info().serverSide ?
						this.s.serverData :
						undefined
				)
			);
			$(this.dom.panes).append(pane.dom.container);
		}

		if (this.c.cascadePanes || this.c.viewTotal) {
			this.redrawPanes(true);
		}
		else {
			this._updateSelection();
		}

		// Attach panes, clear buttons, and title bar to the document
		this._updateFilterCount();
		this._attachPaneContainer();

		// If a single pane has been rebuilt then return only that pane
		if (returnArray.length === 1) {
			return returnArray[0];
		}
		// Otherwise return all of the panes that have been rebuilt
		else {
			return returnArray;
		}
	}

	/**
	 * Redraws all of the panes
	 */
	public redrawPanes(rebuild = false): void {
		let table = this.s.dt;

		// Only do this if the redraw isn't being triggered by the panes updating themselves
		if (!this.s.updating && !this.s.dt.page.info().serverSide) {
			let filterActive: boolean = true;
			let filterPane: number = this.s.filterPane;

			// If the number of rows currently visible is equal to the number of rows in the table
			//  then there can't be any filtering taking place
			if (table.rows({search: 'applied'}).data().toArray().length === table.rows().data().toArray().length) {
				filterActive = false;
			}
			// Otherwise if viewTotal is active then it is necessary to determine which panes a select is present in.
			//  If there is only one pane with a selection present then it should not show the filtered message as
			//  more selections may be made in that pane.
			else if (this.c.viewTotal) {
				for (let pane of this.s.panes) {
					if (pane.s.dtPane !== undefined) {
						let selectLength: number = pane.s.dtPane.rows({selected: true}).data().toArray().length;

						// If filterPane === -1 then a pane with a selection has not been found yet, so set filterPane to that panes index
						if (selectLength > 0 && filterPane === -1) {
							filterPane = pane.s.index;
						}
						// Then if another pane is found with a selection then set filterPane to null to
						//  show that multiple panes have selections present
						else if (selectLength > 0) {
							filterPane = null;
						}
					}
				}
			}

			let deselectIdx: number;
			let newSelectionList: typeInterfaces.ISelectItem[] = [];

			// Don't run this if it is due to the panes regenerating
			if (!this.regenerating) {
				for (let pane of this.s.panes) {
					// Identify the pane where a selection or deselection has been made and add it to the list.
					if (pane.s.selectPresent) {
						this.s.selectionList.push(
							{index: pane.s.index, rows: pane.s.dtPane.rows({selected: true}).data().toArray(), protect: false}
						);
						table.state.save();
						break;
					}
					else if (pane.s.deselect) {
						deselectIdx = pane.s.index;
						let selectedData = pane.s.dtPane.rows({selected: true}).data().toArray();
						if (selectedData.length > 0) {
							this.s.selectionList.push({index: pane.s.index, rows: selectedData, protect: true});
						}
					}
				}

				if (this.s.selectionList.length > 0) {
					let last = this.s.selectionList[this.s.selectionList.length - 1].index;
					for (let pane of this.s.panes) {
						pane.s.lastSelect = (pane.s.index === last);
					}
				}

				// Remove selections from the list from the pane where a deselect has taken place
				for (let i: number = 0; i < this.s.selectionList.length; i++) {
					if (this.s.selectionList[i].index !== deselectIdx || this.s.selectionList[i].protect === true) {
						let further: boolean = false;

						// Find out if this selection is the last one in the list for that pane
						for (let j: number = i + 1; j < this.s.selectionList.length; j++) {
							if (this.s.selectionList[j].index === this.s.selectionList[i].index) {
								further = true;
							}
						}

						// If there are no selections for this pane in the list then just push this one
						if (!further) {
							newSelectionList.push(this.s.selectionList[i]);
							this.s.selectionList[i].protect = false;
						}
					}
				}

				// Update all of the panes to reflect the current state of the filters
				for (let pane of this.s.panes) {
					if (pane.s.dtPane !== undefined) {
						let tempFilter: boolean = true;
						pane.s.filteringActive = true;

						if ((filterPane !== -1 && filterPane !== null && filterPane === pane.s.index) || filterActive === false) {
							tempFilter = false;
							pane.s.filteringActive = false;
						}
						pane.updatePane(!tempFilter ? false : filterActive);
					}
				}

				// Update the label that shows how many filters are in place
				this._updateFilterCount();

				// If the length of the selections are different then some of them have been removed and a deselect has occured
				if (newSelectionList.length > 0 && (newSelectionList.length < this.s.selectionList.length || rebuild)) {
					this._cascadeRegen(newSelectionList);
					let last = newSelectionList[newSelectionList.length - 1].index;
					for (let pane of this.s.panes) {
						pane.s.lastSelect = (pane.s.index === last);
					}
				}
				else if (newSelectionList.length > 0) {
					// Update all of the other panes as you would just making a normal selection
					for (let paneUpdate of this.s.panes) {
						if (paneUpdate.s.dtPane !== undefined) {
							let tempFilter: boolean = true;
							paneUpdate.s.filteringActive = true;

							if ((filterPane !== -1 && filterPane !== null && filterPane === paneUpdate.s.index) || filterActive === false) {
								tempFilter = false;
								paneUpdate.s.filteringActive = false;
							}
							paneUpdate.updatePane(!tempFilter ? tempFilter : filterActive);
						}
					}
				}
			}
			else {
				for (let pane of this.s.panes) {
					if (pane.s.dtPane !== undefined) {
						let tempFilter: boolean = true;
						pane.s.filteringActive = true;

						if ((filterPane !== -1 && filterPane !== null && filterPane === pane.s.index) || filterActive === false) {
							tempFilter = false;
							pane.s.filteringActive = false;
						}

						pane.updatePane(!tempFilter ? tempFilter : filterActive);
					}
				}

				// Update the label that shows how many filters are in place
				this._updateFilterCount();
			}

			if (!filterActive) {
				this.s.selectionList = [];
			}
		}
	}

	/**
	 * Attach the panes, buttons and title to the document
	 */
	private _attach(): JQuery<HTMLElement> {
		$(this.dom.container).removeClass(this.classes.hide);
		$(this.dom.titleRow).removeClass(this.classes.hide);
		$(this.dom.titleRow).remove();
		$(this.dom.title).appendTo(this.dom.titleRow);

		// If the clear button is permitted attach it
		if (this.c.clear) {
			$(this.dom.clearAll).appendTo(this.dom.titleRow);
			$(this.dom.clearAll).on('click.dtsps', () => {
				this.clearSelections();
			});
		}

		$(this.dom.titleRow).appendTo(this.dom.container);

		// Attach the container for each individual pane to the overall container
		for (let pane of this.s.panes) {
			$(pane.dom.container).appendTo(this.dom.panes);
		}

		// Attach everything to the document
		$(this.dom.panes).appendTo(this.dom.container);

		if ($('div.' + this.classes.container).length === 0) {
			$(this.dom.container).prependTo(this.s.dt);
		}

		return this.dom.container;
	}

	/**
	 * Attach the top row containing the filter count and clear all button
	 */
	private _attachExtras(): JQuery<HTMLElement> {
		$(this.dom.container).removeClass(this.classes.hide);
		$(this.dom.titleRow).removeClass(this.classes.hide);
		$(this.dom.titleRow).remove();
		$(this.dom.title).appendTo(this.dom.titleRow);

		// If the clear button is permitted attach it
		if (this.c.clear) {
			$(this.dom.clearAll).appendTo(this.dom.titleRow);
		}

		$(this.dom.titleRow).appendTo(this.dom.container);

		return this.dom.container;
	}

	/**
	 * If there are no panes to display then this method is called to either
	 *   display a message in their place or hide them completely.
	 */
	private _attachMessage(): JQuery<HTMLElement> {
		// Create a message to display on the screen

		let message: string;

		try {
			message = this.s.dt.i18n('searchPanes.emptyPanes', 'No SearchPanes');
		}
		catch (error) {
			message = null;
		}

		// If the message is an empty string then searchPanes.emptyPanes is undefined,
		//  therefore the pane container should be removed from the display
		if (message === null) {
			$(this.dom.container).addClass(this.classes.hide);
			$(this.dom.titleRow).removeClass(this.classes.hide);
			return;
		}
		else {
			$(this.dom.container).removeClass(this.classes.hide);
			$(this.dom.titleRow).addClass(this.classes.hide);
		}

		// Otherwise display the message
		$(this.dom.emptyMessage).text(message);
		this.dom.emptyMessage.appendTo(this.dom.container);
		return this.dom.container;
	}

	/**
	 * Attaches the panes to the document and displays a message or hides if there are none
	 */
	private _attachPaneContainer(): JQuery<HTMLElement> {
		// If a pane is to be displayed then attach the normal pane output
		for (let pane of this.s.panes) {
			if (pane.s.displayed === true) {
				return this._attach();
			}
		}

		// Otherwise attach the custom message or remove the container from the display
		return this._attachMessage();
	}

	/**
	 * Prepares the panes for selections to be made when cascade is active and a deselect has occured
	 * @param newSelectionList the list of selections which are to be made
	 */
	private _cascadeRegen(newSelectionList): void {
		// Set this to true so that the actions taken do not cause this to run until it is finished
		this.regenerating = true;

		// If only one pane has been selected then take note of its index
		let solePane: number = -1;
		if (newSelectionList.length === 1) {
			solePane = newSelectionList[0].index;
		}

		// Let the pane know that a cascadeRegen is taking place to avoid unexpected behaviour
		//  and clear all of the previous selections in the pane
		for (let pane of this.s.panes) {
			pane.setCascadeRegen(true);
			pane.setClear(true);

			// If this is the same as the pane with the only selection then pass it as a parameter into clearPane
			if ((pane.s.dtPane !== undefined && pane.s.index === solePane) || pane.s.dtPane !== undefined) {
				pane.clearPane();
			}

			pane.setClear(false);
		}

		// Remake Selections
		this._makeCascadeSelections(newSelectionList);

		// Set the selection list property to be the list without the selections from the deselect pane
		this.s.selectionList = newSelectionList;

		// The regeneration of selections is over so set it back to false
		for (let pane of this.s.panes) {
			pane.setCascadeRegen(false);
		}

		this.regenerating = false;
	}

	/**
	 * Attaches the message to the document but does not add any panes
	 */
	private _checkMessage(): JQuery<HTMLElement> | void {
		// If a pane is to be displayed then attach the normal pane output
		for (let pane of this.s.panes) {
			if (pane.s.displayed === true) {
				return;
			}
		}

		// Otherwise attach the custom message or remove the container from the display
		return this._attachMessage();
	}

	/**
	 * Gets the selection list from the previous state and stores it in the selectionList Property
	 */
	private _getState(): void {
		let loadedFilter = this.s.dt.state.loaded();

		if (loadedFilter && loadedFilter.searchPanes && loadedFilter.searchPanes.selectionList !== undefined) {
			this.s.selectionList = loadedFilter.searchPanes.selectionList;
		}
	}

	/**
	 * Makes all of the selections when cascade is active
	 * @param newSelectionList the list of selections to be made, in the order they were originally selected
	 */
	private _makeCascadeSelections(newSelectionList): void {
		// make selections in the order they were made previously, excluding those from the pane where a deselect was made
		for (let selection of newSelectionList) {
			// As the selections may have been made across the panes in a different order to the pane index we must identify
			//  which pane has the index of the selection. This is also important for colreorder etc
			for (let pane of this.s.panes) {
				if (pane.s.index === selection.index && pane.s.dtPane !== undefined) {
					// if there are any selections currently in the pane then deselect them as we are about to make our new selections
					if (pane.s.dtPane.rows({selected: true}).data().toArray().length > 0 && pane.s.dtPane !== undefined) {
						pane.setClear(true);
						pane.clearPane();
						pane.setClear(false);
					}

					// select every row in the pane that was selected previously
					for (let row of selection.rows) {
						pane.s.dtPane.rows().every((rowIdx) => {
							if (
								pane.s.dtPane.row(rowIdx).data() !== undefined &&
								row !== undefined &&
								pane.s.dtPane.row(rowIdx).data().filter === row.filter
							) {
								pane.s.dtPane.row(rowIdx).select();
							}
						});
					}

					// Update the label that shows how many filters are in place
					this._updateFilterCount();
				}
			}
		}

		// Make sure that the state is saved after all of these selections
		this.s.dt.state.save();
	}

	/**
	 * Declares the instances of individual searchpanes dependant on the number of columns.
	 * It is necessary to run this once preInit has completed otherwise no panes will be
	 *  created as the column count will be 0.
	 * @param table the DataTable api for the parent table
	 * @param paneSettings the settings passed into the constructor
	 * @param opts the options passed into the constructor
	 */
	private _paneDeclare(table, paneSettings, opts): void {
		// Create Panes
		table
			.columns(this.c.columns.length > 0 ? this.c.columns : undefined)
			.eq(0)
			.each((idx) => {
				this.s.panes.push(new SearchPane(paneSettings, opts, idx, this.c.layout, this.dom.panes));
			});

		// If there is any extra custom panes defined then create panes for them too
		let rowLength: number = table.columns().eq(0).toArray().length;
		let paneLength: number = this.c.panes.length;

		for (let i: number = 0; i < paneLength; i++) {
			let id: number = rowLength + i;
			this.s.panes.push(new SearchPane(paneSettings, opts, id, this.c.layout, this.dom.panes, this.c.panes[i]));
		}

		// If a custom ordering is being used
		if (this.c.order.length > 0) {
			// Make a new Array of panes based upon the order
			let newPanes = this.c.order.map((name, index, values) => {
				return this._findPane(name);
			});

			// Remove the old panes from the dom
			this.dom.panes.empty();
			this.s.panes = newPanes;

			// Append the panes in the correct order
			for (let pane of this.s.panes) {
				this.dom.panes.append(pane.dom.container);
			}
		}

		// If this internal property is true then the DataTable has been initialised already
		if (this.s.dt.settings()[0]._bInitComplete) {
			this._paneStartup(table);
		}
		else {
			// Otherwise add the paneStartup function to the list of functions that are to be run when the table is initialised
			// This will garauntee that the panes are initialised before the init event and init Complete callback is fired
			this.s.dt.settings()[0].aoInitComplete.push({fn: () => {
				this._paneStartup(table);
			}});
		}
	}

	/**
	 * Finds a pane based upon the name of that pane
	 * @param name string representing the name of the pane
	 * @returns SearchPane The pane which has that name
	 */
	private _findPane(name: string): SearchPane {
		for (let pane of this.s.panes) {
			if (name === pane.s.name) {
				return pane;
			}
		}
	}

	/**
	 * Runs the start up functions for the panes to enable listeners and populate panes
	 * @param table the DataTable api for the parent Table
	 */
	private _paneStartup(table): void {
		// Magic number of 500 is a guess at what will be fast
		if (this.s.dt.page.info().recordsTotal <= 500) {
			this._startup(table);
		}
		else {
			setTimeout(() => {
				this._startup(table);
			}, 100);
		}
	}

	/**
	 * Works out which panes to update when data is recieved from the server and viewTotal is active
	 */
	private _serverTotals() {
		let selectPresent = false;
		let deselectPresent = false;
		let table = this.s.dt;
		for (let pane of this.s.panes) {
			// Identify the pane where a selection or deselection has been made and add it to the list.
			if (pane.s.selectPresent) {
				this.s.selectionList.push(
					{index: pane.s.index, rows: pane.s.dtPane.rows({selected: true}).data().toArray(), protect: false}
				);
				table.state.save();
				pane.s.selectPresent = false;
				selectPresent = true;
				break;
			}
			else if (pane.s.deselect) {
				let selectedData = pane.s.dtPane.rows({selected: true}).data().toArray();
				if (selectedData.length > 0) {
					this.s.selectionList.push({index: pane.s.index, rows: selectedData, protect: true});
				}
				selectPresent = true;
				deselectPresent = true;
			}
		}

		// Build an updated list based on any selections or deselections added
		if (!selectPresent) {
			this.s.selectionList = [];
		}
		else {
			let newSelectionList = [];
			for (let i: number = 0; i < this.s.selectionList.length; i++) {
				let further: boolean = false;

				// Find out if this selection is the last one in the list for that pane
				for (let j: number = i + 1; j < this.s.selectionList.length; j++) {
					if (this.s.selectionList[j].index === this.s.selectionList[i].index) {
						further = true;
					}
				}

				// If there are no selections for this pane in the list then just push this one
				if (
					!further &&
					this.s.panes[this.s.selectionList[i].index].s.dtPane.rows({selected: true}).data().toArray().length > 0
				) {
					newSelectionList.push(this.s.selectionList[i]);
				}
			}
			this.s.selectionList = newSelectionList;
		}

		let initIdx = -1;
		// If there has been a deselect and only one pane has a selection then update everything
		if (deselectPresent && this.s.selectionList.length === 1) {
			for (let pane of this.s.panes) {
				pane.s.lastSelect = false;
				pane.s.deselect = false;
				if (pane.s.dtPane !== undefined && pane.s.dtPane.rows({selected: true}).data().toArray().length > 0) {
					initIdx = pane.s.index;
				}
			}
		}
		// Otherwise if there are more 1 selections then find the last one and set it to not update that pane
		else if (this.s.selectionList.length > 0) {
			let last = this.s.selectionList[this.s.selectionList.length - 1].index;
			for (let pane of this.s.panes) {
				pane.s.lastSelect = (pane.s.index === last);
				pane.s.deselect = false;
			}
		}
		// Otherwise if there are no selections then find where that took place and do not update to maintain scrolling
		else if (this.s.selectionList.length === 0) {
			for (let pane of this.s.panes) {
				// pane.s.lastSelect = (pane.s.deselect === true);
				pane.s.lastSelect = false;
				pane.s.deselect = false;
			}
		}

		$(this.dom.panes).empty();
		// Rebuild the desired panes
		for (let pane of this.s.panes) {
			if (!pane.s.lastSelect) {
				pane.rebuildPane(
					undefined,
					this.s.dt.page.info().serverSide ? this.s.serverData : undefined,
					pane.s.index === initIdx ? true : null
				);
			}
			else {
				pane._setListeners();
			}

			// append all of the panes and enable select
			$(this.dom.panes).append(pane.dom.container);
			($.fn.dataTable as any).select.init(pane.s.dtPane);
		}
	}

	/**
	 * Initialises the tables previous/preset selections and initialises callbacks for events
	 * @param table the parent table for which the searchPanes are being created
	 */
	private _startup(table): void {
		$(this.dom.container).text('');

		// Attach clear button and title bar to the document
		this._attachExtras();
		$(this.dom.container).append(this.dom.panes);

		$(this.dom.panes).empty();
		for (let pane of this.s.panes) {
			pane.rebuildPane(undefined, this.s.dt.page.info().serverSide ? this.s.serverData : undefined);
			$(this.dom.panes).append(pane.dom.container);
		}

		this._updateFilterCount();
		this._checkMessage();

		// When a draw is called on the DataTable, update all of the panes incase the data in the DataTable has changed
		table.on('draw.dtsps', () => {
			this._updateFilterCount();
			if ((this.c.cascadePanes || this.c.viewTotal) && !this.s.dt.page.info().serverSide) {
				this.redrawPanes();
			}
			else {
				this._updateSelection();
			}

			this.s.filterPane = -1;
		});

		// Whenever a state save occurs store the selection list in the state object
		this.s.dt.on('stateSaveParams.dtsp', (e, settings, data) => {
			if (data.searchPanes === undefined) {
				data.searchPanes = {};
			}
			data.searchPanes.selectionList = this.s.selectionList;
		});

		// If the data is reloaded from the server then it is possible that it has changed completely,
		// so we need to rebuild the panes
		this.s.dt.on('xhr', () => {
			let processing = false;

			if (!this.s.dt.page.info().serverSide) {
				this.s.dt.one('draw', () => {
					if (processing) {
						return;
					}
					processing = true;
					$(this.dom.panes).empty();

					for (let pane of this.s.panes) {
						pane.clearData(); // Clears all of the bins and will mean that the data has to be re-read
						// Pass a boolean to say whether this is the last choice made for maintaining selections when rebuilding
						pane.rebuildPane(
							this.s.selectionList[this.s.selectionList.length - 1] !== undefined ?
								pane.s.index === this.s.selectionList[this.s.selectionList.length - 1].index :
								false
						);
						$(this.dom.panes).append(pane.dom.container);
					}

					if (this.c.cascadePanes || this.c.viewTotal) {
						this.redrawPanes();
					}
					else {
						this._updateSelection();
					}

					this._checkMessage();
				});
			}
		});

		if (this.s.selectionList !== undefined && this.s.selectionList.length > 0) {
			let last = this.s.selectionList[this.s.selectionList.length - 1].index;
			for (let pane of this.s.panes) {
				pane.s.lastSelect = (pane.s.index === last);
			}
		}

		// If cascadePanes is active then make the previous selections in the order they were previously
		if (this.s.selectionList.length > 0 && this.c.cascadePanes) {
			this._cascadeRegen(this.s.selectionList);
		}

		// PreSelect any selections which have been defined using the preSelect option
		table
		.columns(this.c.columns.length > 0 ? this.c.columns : undefined)
		.eq(0)
		.each((idx) => {
			if (
				this.s.panes[idx] !== undefined &&
				this.s.panes[idx].s.dtPane !== undefined &&
				this.s.panes[idx].s.colOpts.preSelect !== undefined
			) {
				let tableLength = this.s.panes[idx].s.dtPane.rows().data().toArray().length;

				for (let i: number = 0; i < tableLength; i++) {
					if (this.s.panes[idx].s.colOpts.preSelect.indexOf(this.s.panes[idx].s.dtPane.cell(i, 0).data()) !== -1) {
						this.s.panes[idx].s.dtPane.row(i).select();
						this.s.panes[idx].updateTable();
					}
				}
			}
		});

		// Update the title bar to show how many filters have been selected
		this._updateFilterCount();

		// If the table is destroyed and restarted then clear the selections so that they do not persist.
		table.on('destroy.dtsps', () => {
			for (let pane of this.s.panes) {
				pane.destroy();
			}

			table.off('.dtsps');
			$(this.dom.clearAll).off('.dtsps');
			$(this.dom.container).remove();
			this.clearSelections();
		});

		// When the clear All button has been pressed clear all of the selections in the panes
		if (this.c.clear) {
			$(this.dom.clearAll).on('click.dtsps', () => {
				this.clearSelections();
			});
		}

		if (this.s.dt.page.info().serverSide) {
			table.on('preXhr.dt', (e, settings, data) => {
				if (data.searchPanes === undefined) {
					data.searchPanes = {};
				}

				for (let pane of this.s.panes) {
					let src = this.s.dt.column(pane.s.index).dataSrc();

					if (data.searchPanes[src] === undefined) {
						data.searchPanes[src] = [];
					}

					if (pane.s.dtPane !== undefined) {
						let rowData =  pane.s.dtPane.rows({selected: true}).data().toArray();

						for (let dataPoint of rowData) {
							data.searchPanes[src].push(dataPoint.display);
						}
					}
				}

				if (this.c.viewTotal) {
					this._prepViewTotal();
				}
			});
		}

		table.settings()[0]._searchPanes = this;
	}

	private _prepViewTotal() {
		let filterPane: number = this.s.filterPane;
		let filterActive: boolean = false;
		for (let pane of this.s.panes) {
			if (pane.s.dtPane !== undefined) {
				let selectLength: number = pane.s.dtPane.rows({selected: true}).data().toArray().length;

				// If filterPane === -1 then a pane with a selection has not been found yet, so set filterPane to that panes index
				if (selectLength > 0 && filterPane === -1) {
					filterPane = pane.s.index;
					filterActive = true;
				}
				// Then if another pane is found with a selection then set filterPane to null to
				//  show that multiple panes have selections present
				else if (selectLength > 0) {
					filterPane = null;
				}
			}
		}

		// Update all of the panes to reflect the current state of the filters
		for (let pane of this.s.panes) {
			if (pane.s.dtPane !== undefined) {
				pane.s.filteringActive = true;

				if ((filterPane !== -1 && filterPane !== null && filterPane === pane.s.index) || filterActive === false) {
					pane.s.filteringActive = false;
				}
			}
		}
	}
	/**
	 * Updates the number of filters that have been applied in the title
	 */
	private _updateFilterCount(): void {
		let filterCount: number = 0;

		// Add the number of all of the filters throughout the panes
		for (let pane of this.s.panes) {
			if (pane.s.dtPane !== undefined) {
				filterCount += pane.getPaneCount();
			}
		}

		// Run the message through the internationalisation method to improve readability
		let message: string = this.s.dt.i18n('searchPanes.title', 'Filters Active - %d', filterCount);
		$(this.dom.title).text(message);

		if (this.c.filterChanged !== undefined && typeof this.c.filterChanged === 'function') {
			this.c.filterChanged(filterCount);
		}
	}

	/**
	 * Updates the selectionList when cascade is not in place
	 */
	private _updateSelection() {
		this.s.selectionList = [];
		for (let pane of this.s.panes) {
			if (pane.s.dtPane !== undefined) {
				this.s.selectionList.push(
					{index: pane.s.index, rows: pane.s.dtPane.rows({selected: true}).data().toArray(), protect: false}
				);
			}
		}
		this.s.dt.state.save();
	}
}
