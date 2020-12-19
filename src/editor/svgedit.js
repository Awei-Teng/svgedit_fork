/* globals jQuery */
/**
* The main module for the visual SVG Editor.
*
* @license MIT
*
* @copyright 2010 Alexis Deveria
* 2010 Pavol Rusnak
* 2010 Jeff Schiller
* 2010 Narendra Sisodiya
* 2014 Brett Zamir
* 2020 OptimistikSAS
* @module SVGEditor
* @borrows module:locale.putLocale as putLocale
* @borrows module:locale.readLang as readLang
* @borrows module:locale.setStrings as setStrings
*/

import './touch.js';
import {NS} from '../common/namespaces.js';
import {isChrome, isGecko, isMac} from '../common/browser.js';

// Until we split this into smaller files, this helps distinguish utilities
//   from local methods
import * as Utils from '../common/utilities.js';
import {getTypeMap, convertUnit, isValidUnit} from '../common/units.js';
import {
  hasCustomHandler, getCustomHandler, injectExtendedContextMenuItemsIntoDom
} from './contextmenu.js';

import SvgCanvas from '../svgcanvas/svgcanvas.js';

import jQueryPluginJSHotkeys from './js-hotkeys/jquery.hotkeys.min.js';
import jQueryPluginJGraduate from './jgraduate/jQuery.jGraduate.js';
import jQueryPluginContextMenu from './contextmenu/jQuery.contextMenu.js';
import jQueryPluginJPicker from './jgraduate/jQuery.jPicker.js';
import jQueryPluginDBox from '../svgcanvas/dbox.js';

import ConfigObj from './ConfigObj.js';
import LayersPanel from './LayersPanel.js';

import {
  readLang, putLocale,
  setStrings
} from './locale.js';

const {$qq, $id} = Utils;

const editor = {
  /**
  * @type {Float}
  */
  tool_scale: 1,
  /**
  * @type {Integer}
  */
  exportWindowCt: 0,
  /**
  * @type {boolean}
  */
  langChanged: false,
  /**
  * @type {boolean}
  */
  showSaveWarning: false,
  /**
   * Will be set to a boolean by `ext-storage.js`
   * @type {"ignore"|"waiting"|"closed"}
  */
  storagePromptState: 'ignore',
  /*
   * EDITOR PUBLIC METHODS
  */
  putLocale,
  readLang,
  setStrings
};

const $ = [
  jQueryPluginJSHotkeys, jQueryPluginJGraduate,
  jQueryPluginContextMenu, jQueryPluginJPicker
].reduce((jq, func) => func(jq), jQuery);

const homePage = 'https://github.com/SVG-Edit/svgedit';

const callbacks = [];

/**
* LOCALE.
* @name module:SVGEditor.uiStrings
* @type {PlainObject}
*/
const uiStrings = editor.uiStrings = {};

let svgCanvas,
  isReady = false,
  customExportImage = false,
  customExportPDF = false;

/**
 *
 * @param {string} str SVG string
 * @param {PlainObject} [opts={}]
 * @param {boolean} [opts.noAlert]
 * @throws {Error} Upon failure to load SVG
 */
const loadSvgString = (str, {noAlert} = {}) => {
  const success = svgCanvas.setSvgString(str) !== false;
  if (success) return;
  // eslint-disable-next-line no-alert
  if (!noAlert) window.alert(uiStrings.notification.errorLoadingSVG);
  throw new Error('Error loading SVG');
};

const configObj = new ConfigObj(editor);

/**
* EXPORTS.
*/

editor.pref = configObj.pref.bind(configObj);
editor.setConfig = configObj.setConfig.bind(configObj);
editor.curPrefs = configObj.curPrefs;
editor.curConfig = configObj.curConfig;

/**
* All methods are optional.
* @interface module:SVGEditor.CustomHandler
* @type {PlainObject}
*/
/**
* Its responsibilities are:
*  - invoke a file chooser dialog in 'open' mode
*  - let user pick a SVG file
*  - calls [svgCanvas.setSvgString()]{@link module:svgcanvas.SvgCanvas#setSvgString} with the string contents of that file.
* Not passed any parameters.
* @function module:SVGEditor.CustomHandler#open
* @returns {void}
*/
/**
* Its responsibilities are:
*  - accept the string contents of the current document
*  - invoke a file chooser dialog in 'save' mode
*  - save the file to location chosen by the user.
* @function module:SVGEditor.CustomHandler#save
* @param {external:Window} win
* @param {module:svgcanvas.SvgCanvas#event:saved} svgStr A string of the SVG
* @listens module:svgcanvas.SvgCanvas#event:saved
* @returns {void}
*/
/**
* Its responsibilities (with regard to the object it is supplied in its 2nd argument) are:
*  - inform user of any issues supplied via the "issues" property
*  - convert the "svg" property SVG string into an image for export;
*    utilize the properties "type" (currently 'PNG', 'JPEG', 'BMP',
*    'WEBP', 'PDF'), "mimeType", and "quality" (for 'JPEG' and 'WEBP'
*    types) to determine the proper output.
* @function module:SVGEditor.CustomHandler#exportImage
* @param {external:Window} win
* @param {module:svgcanvas.SvgCanvas#event:exported} data
* @listens module:svgcanvas.SvgCanvas#event:exported
* @returns {void}
*/
/**
* @function module:SVGEditor.CustomHandler#exportPDF
* @param {external:Window} win
* @param {module:svgcanvas.SvgCanvas#event:exportedPDF} data
* @listens module:svgcanvas.SvgCanvas#event:exportedPDF
* @returns {void}
*/

/**
* Allows one to override default SVGEdit `open`, `save`, and
* `export` editor behaviors.
* @function module:SVGEditor.setCustomHandlers
* @param {module:SVGEditor.CustomHandler} opts Extension mechanisms may call `setCustomHandlers` with three functions: `opts.open`, `opts.save`, and `opts.exportImage`
* @returns {Promise<void>}
*/
editor.setCustomHandlers = function (opts) {
  return editor.ready(() => {
    if (opts.open) {
      $('#tool_open > input[type="file"]').remove();
      $('#tool_open').show();
      svgCanvas.open = opts.open;
    }
    if (opts.save) {
      editor.showSaveWarning = false;
      svgCanvas.bind('saved', opts.save);
    }
    if (opts.exportImage) {
      customExportImage = opts.exportImage;
      svgCanvas.bind('exported', customExportImage); // canvg and our RGBColor will be available to the method
    }
    if (opts.exportPDF) {
      customExportPDF = opts.exportPDF;
      svgCanvas.bind('exportedPDF', customExportPDF); // jsPDF and our RGBColor will be available to the method
    }
  });
};

/**
 * @function module:SVGEditor.randomizeIds
 * @param {boolean} arg
 * @returns {void}
 */
editor.randomizeIds = (arg) => {
  svgCanvas.randomizeIds(arg);
};

/**
* Auto-run after a Promise microtask.
* @function module:SVGEditor.init
* @returns {void}
*/
editor.init = () => {
  try {
    if ('localStorage' in window) { // && onWeb removed so Webkit works locally
      /**
      * The built-in interface implemented by `localStorage`
      * @external Storage
      */
      /**
      * @name storage
      * @memberof module:SVGEditor
      * @type {external:Storage}
      */
      editor.storage = localStorage;
    }
    // Image props dialog added to DOM
    const newSeImgPropDialog = document.createElement('se-img-prop-dialog');
    newSeImgPropDialog.setAttribute('id', 'se-img-prop');
    document.body.append(newSeImgPropDialog);
    // editor prefences dialoag added to DOM
    const newSeEditPrefsDialog = document.createElement('se-edit-prefs-dialog');
    newSeEditPrefsDialog.setAttribute('id', 'se-edit-prefs');
    document.body.append(newSeEditPrefsDialog);
  } catch (err) {}

  configObj.load();

  // eslint-disable-next-line max-len
  const goodLangs = ['ar', 'cs', 'de', 'en', 'es', 'fa', 'fr', 'fy', 'hi', 'it', 'ja', 'nl', 'pl', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'zh-CN', 'zh-TW'];
  /**
   * @fires module:svgcanvas.SvgCanvas#event:ext_addLangData
   * @fires module:svgcanvas.SvgCanvas#event:ext_langReady
   * @fires module:svgcanvas.SvgCanvas#event:ext_langChanged
   * @fires module:svgcanvas.SvgCanvas#event:extensions_added
   * @returns {Promise<module:locale.LangAndData>} Resolves to result of {@link module:locale.readLang}
   */
  const extAndLocaleFunc = async () => {
    const {langParam, langData} = await editor.putLocale(editor.pref('lang'), goodLangs);
    await setLang(langParam, langData);

    const {ok, cancel} = uiStrings.common;
    jQueryPluginDBox($, {ok, cancel});

    $id('svg_container').style.visibility = 'visible';

    try {
      // load standard extensions
      await Promise.all(
        configObj.curConfig.extensions.map(async (extname) => {
          /**
           * @tutorial ExtensionDocs
           * @typedef {PlainObject} module:SVGEditor.ExtensionObject
           * @property {string} [name] Name of the extension. Used internally; no need for i18n. Defaults to extension name without beginning "ext-" or ending ".js".
           * @property {module:svgcanvas.ExtensionInitCallback} [init]
           */
          try {
            /**
             * @type {module:SVGEditor.ExtensionObject}
             */
            const imported = await import(`./extensions/${encodeURIComponent(extname)}/${encodeURIComponent(extname)}.js`);
            const {name = extname, init} = imported.default;
            return editor.addExtension(name, (init && init.bind(editor)), {$, langParam});
          } catch (err) {
            // Todo: Add config to alert any errors
            console.error('Extension failed to load: ' + extname + '; ', err); // eslint-disable-line no-console
            return undefined;
          }
        })
      );
      // load user extensions (given as pathNames)
      await Promise.all(
        configObj.curConfig.userExtensions.map(async (extPathName) => {
          /**
           * @tutorial ExtensionDocs
           * @typedef {PlainObject} module:SVGEditor.ExtensionObject
           * @property {string} [name] Name of the extension. Used internally; no need for i18n. Defaults to extension name without beginning "ext-" or ending ".js".
           * @property {module:svgcanvas.ExtensionInitCallback} [init]
           */
          try {
            /**
             * @type {module:SVGEditor.ExtensionObject}
             */
            const imported = await import(encodeURI(extPathName));
            const {name, init} = imported.default;
            return editor.addExtension(name, (init && init.bind(editor)), {$, langParam});
          } catch (err) {
            // Todo: Add config to alert any errors
            console.error('Extension failed to load: ' + extPathName + '; ', err); // eslint-disable-line no-console
            return undefined;
          }
        })
      );
      svgCanvas.bind(
        'extensions_added',
        /**
        * @param {external:Window} win
        * @param {module:svgcanvas.SvgCanvas#event:extensions_added} data
        * @listens module:svgcanvas.SvgCanvas#event:extensions_added
        * @returns {void}
        */
        (win, data) => {
          extensionsAdded = true;
          Actions.setAll();

          if (editor.storagePromptState === 'ignore') {
            updateCanvas(true);
          }

          messageQueue.forEach(
            /**
             * @param {module:svgcanvas.SvgCanvas#event:message} messageObj
             * @fires module:svgcanvas.SvgCanvas#event:message
             * @returns {void}
             */
            (messageObj) => {
              svgCanvas.call('message', messageObj);
            }
          );
        }
      );
      svgCanvas.call('extensions_added');
    } catch (err) {
      // Todo: Report errors through the UI
      console.log(err); // eslint-disable-line no-console
    }
  };

  /**
  * @type {string}
  */
  const uaPrefix = (function () {
    const regex = /^(?:Moz|Webkit|Khtml|O|ms|Icab)(?=[A-Z])/;
    const someScript = document.getElementsByTagName('script')[0];
    for (const prop in someScript.style) {
      if (regex.test(prop)) {
        // test is faster than match, so it's better to perform
        // that on the lot and match only when necessary
        return prop.match(regex)[0];
      }
    }
    // Nothing found so far?
    if ('WebkitOpacity' in someScript.style) { return 'Webkit'; }
    if ('KhtmlOpacity' in someScript.style) { return 'Khtml'; }

    return '';
  }());

  /**
  * @name module:SVGEditor.canvas
  * @type {module:svgcanvas.SvgCanvas}
  */
  editor.canvas = svgCanvas = new SvgCanvas(
    $id('svgcanvas'),
    configObj.curConfig
  );

  /**
  * Updates the context panel tools based on the selected element.
  * @returns {void}
  */
  const updateContextPanel = () => {
    let elem = selectedElement;
    // If element has just been deleted, consider it null
    if (!Utils.isNullish(elem) && !elem.parentNode) { elem = null; }
    const currentLayerName = svgCanvas.getCurrentDrawing().getCurrentLayerName();
    const currentMode = svgCanvas.getMode();
    const unit = configObj.curConfig.baseUnit !== 'px' ? configObj.curConfig.baseUnit : null;

    const isNode = currentMode === 'pathedit'; // elem ? (elem.id && elem.id.startsWith('pathpointgrip')) : false;
    const menuItems = $('#cmenu_canvas li');
    $('#selected_panel, #multiselected_panel, #g_panel, #rect_panel, #circle_panel,' +
    '#ellipse_panel, #line_panel, #text_panel, #image_panel, #container_panel,' +
    ' #use_panel, #a_panel').hide();
    if (!Utils.isNullish(elem)) {
      const elname = elem.nodeName;
      // If this is a link with no transform and one child, pretend
      // its child is selected
      // if (elname === 'a') { // && !$(elem).attr('transform')) {
      //   elem = elem.firstChild;
      // }

      const angle = svgCanvas.getRotationAngle(elem);
      $('#angle').val(angle);

      const blurval = svgCanvas.getBlur(elem) * 10;
      $id('blur').value = blurval;

      if (svgCanvas.addedNew &&
        elname === 'image' &&
        svgCanvas.getMode() === 'image' &&
        !svgCanvas.getHref(elem).startsWith('data:')) {
        /* await */ promptImgURL({cancelDeletes: true});
      }

      if (!isNode && currentMode !== 'pathedit') {
        $('#selected_panel').show();
        // Elements in this array already have coord fields
        if (['line', 'circle', 'ellipse'].includes(elname)) {
          $('#xy_panel').hide();
        } else {
          let x, y;

          // Get BBox vals for g, polyline and path
          if (['g', 'polyline', 'path'].includes(elname)) {
            const bb = svgCanvas.getStrokedBBox([elem]);
            if (bb) {
              ({x, y} = bb);
            }
          } else {
            x = elem.getAttribute('x');
            y = elem.getAttribute('y');
          }

          if (unit) {
            x = convertUnit(x);
            y = convertUnit(y);
          }

          $('#selected_x').val(x || 0);
          $('#selected_y').val(y || 0);
          $('#xy_panel').show();
        }

        // Elements in this array cannot be converted to a path
        $id('tool_topath').style.display = ['image', 'text', 'path', 'g', 'use'].includes(elname) ? 'none' : 'block';
        $id('tool_reorient').style.display = (elname === 'path') ? 'block' : 'none';
        $id('tool_reorient').disabled = (angle === 0);
      } else {
        const point = path.getNodePoint();
        $('#tool_add_subpath').pressed = false;
        $('#tool_node_delete').toggleClass('disabled', !path.canDeleteNodes);

        // Show open/close button based on selected point
        // setIcon('#tool_openclose_path', path.closed_subpath ? 'open_path' : 'close_path');

        if (point) {
          const segType = $('#seg_type');
          if (unit) {
            point.x = convertUnit(point.x);
            point.y = convertUnit(point.y);
          }
          $('#path_node_x').val(point.x);
          $('#path_node_y').val(point.y);
          if (point.type) {
            segType.val(point.type).removeAttr('disabled');
          } else {
            segType.val(4).attr('disabled', 'disabled');
          }
        }
        return;
      }

      // update contextual tools here
      const panels = {
        g: [],
        a: [],
        rect: ['rx', 'width', 'height'],
        image: ['width', 'height'],
        circle: ['cx', 'cy', 'r'],
        ellipse: ['cx', 'cy', 'rx', 'ry'],
        line: ['x1', 'y1', 'x2', 'y2'],
        text: [],
        use: []
      };

      const {tagName} = elem;

      // if ($(elem).data('gsvg')) {
      //   $('#g_panel').show();
      // }

      let linkHref = null;
      if (tagName === 'a') {
        linkHref = svgCanvas.getHref(elem);
        $('#g_panel').show();
      }

      if (elem.parentNode.tagName === 'a' && !$(elem).siblings().length) {
        $('#a_panel').show();
        linkHref = svgCanvas.getHref(elem.parentNode);
      }

      // Hide/show the make_link buttons
      $('#tool_make_link, #tool_make_link_multi').toggle(!linkHref);

      if (linkHref) {
        $('#link_url').val(linkHref);
      }

      if (panels[tagName]) {
        const curPanel = panels[tagName];

        $('#' + tagName + '_panel').show();

        $.each(curPanel, function (i, item) {
          let attrVal = elem.getAttribute(item);
          if (configObj.curConfig.baseUnit !== 'px' && elem[item]) {
            const bv = elem[item].baseVal.value;
            attrVal = convertUnit(bv);
          }
          $('#' + tagName + '_' + item).val(attrVal || 0);
        });

        if (tagName === 'text') {
          $('#text_panel').css('display', 'inline');
          $('#tool_font_size').css('display', 'inline');
          $id('tool_italic').pressed = svgCanvas.getItalic();
          $id('tool_bold').pressed = svgCanvas.getBold();
          $('#font_family').val(elem.getAttribute('font-family'));
          $('#font_size').val(elem.getAttribute('font-size'));
          $('#text').val(elem.textContent);
          if (svgCanvas.addedNew) {
          // Timeout needed for IE9
            setTimeout(() => {
              $('#text').focus().select();
            }, 100);
          }
          // text
        } else if (tagName === 'image' && svgCanvas.getMode() === 'image') {
          setImageURL(svgCanvas.getHref(elem));
          // image
        } else if (tagName === 'g' || tagName === 'use') {
          $('#container_panel').show();
          const title = svgCanvas.getTitle();
          const label = $('#g_title')[0];
          label.value = title;
          setInputWidth(label);
          $('#g_title').prop('disabled', tagName === 'use');
        }
      }
      menuItems[(tagName === 'g' ? 'en' : 'dis') + 'ableContextMenuItems']('#ungroup');
      menuItems[((tagName === 'g' || !multiselected) ? 'dis' : 'en') + 'ableContextMenuItems']('#group');
      // if (!Utils.isNullish(elem))
    } else if (multiselected) {
      $('#multiselected_panel').show();
      menuItems
        .enableContextMenuItems('#group')
        .disableContextMenuItems('#ungroup');
    } else {
      menuItems.disableContextMenuItems('#delete,#cut,#copy,#group,#ungroup,#move_front,#move_up,#move_down,#move_back');
    }

    // update history buttons
    $id('tool_undo').disabled = (undoMgr.getUndoStackSize() === 0);
    $id('tool_redo').disabled = (undoMgr.getRedoStackSize() === 0);

    svgCanvas.addedNew = false;

    if ((elem && !isNode) || multiselected) {
    // update the selected elements' layer
      $('#selLayerNames').removeAttr('disabled').val(currentLayerName);

      // Enable regular menu options
      canvMenu.enableContextMenuItems(
        '#delete,#cut,#copy,#move_front,#move_up,#move_down,#move_back'
      );
    } else {
      $('#selLayerNames').attr('disabled', 'disabled');
    }
  };

  const layersPanel = new LayersPanel(svgCanvas, uiStrings, updateContextPanel);

  const modKey = (isMac() ? 'meta+' : 'ctrl+');
  const path = svgCanvas.pathActions;
  const {undoMgr} = svgCanvas;
  const workarea = $('#workarea');
  const canvMenu = $('#cmenu_canvas');
  const paintBox = {fill: null, stroke: null};

  let exportWindow = null,
    defaultImageURL = configObj.curConfig.imgPath + 'logo.svg',
    zoomInIcon = 'crosshair',
    zoomOutIcon = 'crosshair',
    uiContext = 'toolbars';

  // For external openers
  (function () {
    // let the opener know SVG Edit is ready (now that config is set up)
    const w = window.opener || window.parent;
    if (w) {
      try {
        /**
         * Triggered on a containing `document` (of `window.opener`
         * or `window.parent`) when the editor is loaded.
         * @event module:SVGEditor#event:svgEditorReadyEvent
         * @type {Event}
         * @property {true} bubbles
         * @property {true} cancelable
         */
        /**
         * @name module:SVGEditor.svgEditorReadyEvent
         * @type {module:SVGEditor#event:svgEditorReadyEvent}
         */
        const svgEditorReadyEvent = new w.CustomEvent('svgEditorReady', {
          bubbles: true,
          cancelable: true
        });
        w.document.documentElement.dispatchEvent(svgEditorReadyEvent);
      } catch (e) {}
    }
  }());

  // Make [1,2,5] array
  const rIntervals = [];
  for (let i = 0.1; i < 1e5; i *= 10) {
    rIntervals.push(i);
    rIntervals.push(2 * i);
    rIntervals.push(5 * i);
  }

  layersPanel.populateLayers();

  let editingsource = false;
  let origSource = '';

  /**
  * @param {Event} [e] Not used.
  * @param {boolean} forSaving
  * @returns {void}
  */
  const showSourceEditor = function (e, forSaving) {
    if (editingsource) { return; }

    editingsource = true;
    origSource = svgCanvas.getSvgString();
    $('#save_output_btns').toggle(Boolean(forSaving));
    $('#tool_source_back').toggle(!forSaving);
    $('#svg_source_textarea').val(origSource);
    $('#svg_source_editor').fadeIn();
    $('#svg_source_textarea').focus();
  };

  let selectedElement = null;
  let multiselected = false;

  /**
  * @param {boolean} editmode
  * @param {module:svgcanvas.SvgCanvas#event:selected} elems
  * @returns {void}
  */
  const togglePathEditMode = function (editmode, elems) {
    $('#path_node_panel').toggle(editmode);
    if (editmode) {
      // Change select icon
      $('.tool_button_current').removeClass('tool_button_current').addClass('tool_button');
      $('#tool_select').addClass('tool_button_current').removeClass('tool_button');
      multiselected = false;
      if (elems.length) {
        selectedElement = elems[0];
      }
    } else {
      setTimeout(() => {
        // setIcon('#tool_select', 'select');
      }, 1000);
    }
  };

  /**
   * @type {module:svgcanvas.EventHandler}
   * @param {external:Window} wind
   * @param {module:svgcanvas.SvgCanvas#event:saved} svg The SVG source
   * @listens module:svgcanvas.SvgCanvas#event:saved
   * @returns {void}
   */
  const saveHandler = function (wind, svg) {
    editor.showSaveWarning = false;

    // by default, we add the XML prolog back, systems integrating SVG-edit (wikis, CMSs)
    // can just provide their own custom save handler and might not want the XML prolog
    svg = '<?xml version="1.0"?>\n' + svg;

    // Since saving SVGs by opening a new window was removed in Chrome use artificial link-click
    // https://stackoverflow.com/questions/45603201/window-is-not-allowed-to-navigate-top-frame-navigations-to-data-urls
    const a = document.createElement('a');
    a.href = 'data:image/svg+xml;base64,' + Utils.encode64(svg);
    a.download = 'icon.svg';
    a.style.display = 'none';
    document.body.append(a); // Need to append for Firefox

    a.click();

    // Alert will only appear the first time saved OR the
    //   first time the bug is encountered
    let done = editor.pref('save_notice_done');

    if (done !== 'all') {
      let note = uiStrings.notification.saveFromBrowser.replace('%s', 'SVG');
      // Check if FF and has <defs/>
      if (isGecko()) {
        if (svg.includes('<defs')) {
          // warning about Mozilla bug #308590 when applicable (seems to be fixed now in Feb 2013)
          note += '\n\n' + uiStrings.notification.defsFailOnSave;
          editor.pref('save_notice_done', 'all');
          done = 'all';
        } else {
          editor.pref('save_notice_done', 'part');
        }
      } else {
        editor.pref('save_notice_done', 'all');
      }
      if (done !== 'part') {
        $.alert(note);
      }
    }
  };

  /**
   * @param {external:Window} win
   * @param {module:svgcanvas.SvgCanvas#event:exported} data
   * @listens module:svgcanvas.SvgCanvas#event:exported
   * @returns {void}
   */
  const exportHandler = function (win, data) {
    const {issues, exportWindowName} = data;

    exportWindow = window.open(Utils.blankPageObjectURL || '', exportWindowName); // A hack to get the window via JSON-able name without opening a new one

    if (!exportWindow || exportWindow.closed) {
      /* await */ $.alert(uiStrings.notification.popupWindowBlocked);
      return;
    }

    exportWindow.location.href = data.bloburl || data.datauri;
    const done = editor.pref('export_notice_done');
    if (done !== 'all') {
      let note = uiStrings.notification.saveFromBrowser.replace('%s', data.type);

      // Check if there are issues
      if (issues.length) {
        const pre = '\n \u2022 ';
        note += ('\n\n' + uiStrings.notification.noteTheseIssues + pre + issues.join(pre));
      }

      // Note that this will also prevent the notice even though new issues may appear later.
      // May want to find a way to deal with that without annoying the user
      editor.pref('export_notice_done', 'all');
      exportWindow.alert(note);
    }
  };

  /**
   *
   * @param {Element} opt
   * @param {boolean} changeElem
   * @returns {void}
   */
  function setStrokeOpt (opt, changeElem) {
    const {id} = opt;
    const bits = id.split('_');
    const [pre, val] = bits;

    if (changeElem) {
      svgCanvas.setStrokeAttr('stroke-' + pre, val);
    }
    $(opt).addClass('current').siblings().removeClass('current');
  }

  /**
  * This is a common function used when a tool has been clicked (chosen).
  * It does several common things:
  * - Removes the `tool_button_current` class from whatever tool currently has it.
  * - Adds the `tool_button_current` class to the button passed in.
  * @function updateLeftPanel
  * @param {string|Element} button The DOM element or string selector representing the toolbar button
  * @returns {boolean} Whether the button was disabled or not
  */
  const updateLeftPanel = (button) => {
    if (button.disabled) return false;
    // remove the pressed state on other(s) button(s)
    $qq('#tools_left *[pressed]').forEach((b) => { b.pressed = false; });
    // pressed state for the clicked button
    $id(button).pressed = true;
    return true;
  };

  /**
  * Unless the select toolbar button is disabled, sets the button
  * and sets the select mode and cursor styles.
  * @function module:SVGEditor.clickSelect
  * @returns {void}
  */
  const clickSelect = () => {
    if (updateLeftPanel('tool_select')) {
      workarea.css('cursor', 'auto');
      svgCanvas.setMode('select');
    }
  };

  /**
  * Set a selected image's URL.
  * @function module:SVGEditor.setImageURL
  * @param {string} url
  * @returns {void}
  */
  const setImageURL = editor.setImageURL = function (url) {
    if (!url) {
      url = defaultImageURL;
    }
    svgCanvas.setImageURL(url);
    $('#image_url').val(url);

    if (url.startsWith('data:')) {
      // data URI found
      $('#image_url').hide();
      $('#change_image_url').show();
    } else {
      // regular URL
      svgCanvas.embedImage(url, function (dataURI) {
        // Couldn't embed, so show warning
        $('#url_notice').toggle(!dataURI);
        defaultImageURL = url;
      });
      $('#image_url').show();
      $('#change_image_url').hide();
    }
  };

  /**
   *
   * @param {string} color
   * @param {string} url
   * @returns {void}
   */
  function setBackground (color, url) {
    // if (color == editor.pref('bkgd_color') && url == editor.pref('bkgd_url')) { return; }
    editor.pref('bkgd_color', color);
    editor.pref('bkgd_url', url, true);

    // This should be done in svgcanvas.js for the borderRect fill
    svgCanvas.setBackground(color, url);
  }

  /**
   * @param {PlainObject} [opts={}]
   * @param {boolean} [opts.cancelDeletes=false]
   * @returns {Promise<void>} Resolves to `undefined`
   */
  async function promptImgURL ({cancelDeletes = false} = {}) {
    let curhref = svgCanvas.getHref(selectedElement);
    curhref = curhref.startsWith('data:') ? '' : curhref;
    const url = await $.prompt(uiStrings.notification.enterNewImgURL, curhref);
    if (url) {
      setImageURL(url);
    } else if (cancelDeletes) {
      svgCanvas.deleteSelectedElements();
    }
  }

  /**
  * @param {Element} elem
  * @returns {void}
  */
  const setInputWidth = (elem) => {
    const w = Math.min(Math.max(12 + elem.value.length * 6, 50), 300);
    $(elem).width(w);
  };

  /**
   *
   * @param {HTMLDivElement} [scanvas]
   * @param {Float} [zoom]
   * @returns {void}
   */
  function updateRulers (scanvas, zoom) {
    if (!zoom) { zoom = svgCanvas.getZoom(); }
    if (!scanvas) { scanvas = $('#svgcanvas'); }

    let d, i;
    const limit = 30000;
    const contentElem = svgCanvas.getContentElem();
    const units = getTypeMap();
    const unit = units[configObj.curConfig.baseUnit]; // 1 = 1px

    // draw x ruler then y ruler
    for (d = 0; d < 2; d++) {
      const isX = (d === 0);
      const dim = isX ? 'x' : 'y';
      const lentype = isX ? 'width' : 'height';
      const contentDim = Number(contentElem.getAttribute(dim));

      const $hcanvOrig = $('#ruler_' + dim + ' canvas:first');

      // Bit of a hack to fully clear the canvas in Safari & IE9
      const $hcanv = $hcanvOrig.clone();
      $hcanvOrig.replaceWith($hcanv);

      const hcanv = $hcanv[0];

      // Set the canvas size to the width of the container
      let rulerLen = scanvas[lentype]();
      const totalLen = rulerLen;
      hcanv.parentNode.style[lentype] = totalLen + 'px';
      let ctx = hcanv.getContext('2d');
      let ctxArr, num, ctxArrNum;

      ctx.fillStyle = 'rgb(200,0,0)';
      ctx.fillRect(0, 0, hcanv.width, hcanv.height);

      // Remove any existing canvasses
      $hcanv.siblings().remove();

      // Create multiple canvases when necessary (due to browser limits)
      if (rulerLen >= limit) {
        ctxArrNum = Number.parseInt(rulerLen / limit) + 1;
        ctxArr = [];
        ctxArr[0] = ctx;
        let copy;
        for (i = 1; i < ctxArrNum; i++) {
          hcanv[lentype] = limit;
          copy = hcanv.cloneNode(true);
          hcanv.parentNode.append(copy);
          ctxArr[i] = copy.getContext('2d');
        }

        copy[lentype] = rulerLen % limit;

        // set copy width to last
        rulerLen = limit;
      }

      hcanv[lentype] = rulerLen;

      const uMulti = unit * zoom;

      // Calculate the main number interval
      const rawM = 50 / uMulti;
      let multi = 1;
      for (i = 0; i < rIntervals.length; i++) {
        num = rIntervals[i];
        multi = num;
        if (rawM <= num) {
          break;
        }
      }

      const bigInt = multi * uMulti;

      ctx.font = '9px sans-serif';

      let rulerD = ((contentDim / uMulti) % multi) * uMulti;
      let labelPos = rulerD - bigInt;
      // draw big intervals
      let ctxNum = 0;
      while (rulerD < totalLen) {
        labelPos += bigInt;
        // const realD = rulerD - contentDim; // Currently unused

        const curD = Math.round(rulerD) + 0.5;
        if (isX) {
          ctx.moveTo(curD, 15);
          ctx.lineTo(curD, 0);
        } else {
          ctx.moveTo(15, curD);
          ctx.lineTo(0, curD);
        }

        num = (labelPos - contentDim) / uMulti;
        let label;
        if (multi >= 1) {
          label = Math.round(num);
        } else {
          const decs = String(multi).split('.')[1].length;
          label = num.toFixed(decs);
        }

        // Change 1000s to Ks
        if (label !== 0 && label !== 1000 && label % 1000 === 0) {
          label = (label / 1000) + 'K';
        }

        if (isX) {
          ctx.fillText(label, rulerD + 2, 8);
        } else {
          // draw label vertically
          const str = String(label).split('');
          for (i = 0; i < str.length; i++) {
            ctx.fillText(str[i], 1, (rulerD + 9) + i * 9);
          }
        }

        const part = bigInt / 10;
        // draw the small intervals
        for (i = 1; i < 10; i++) {
          let subD = Math.round(rulerD + part * i) + 0.5;
          if (ctxArr && subD > rulerLen) {
            ctxNum++;
            ctx.stroke();
            if (ctxNum >= ctxArrNum) {
              i = 10;
              rulerD = totalLen;
              continue;
            }
            ctx = ctxArr[ctxNum];
            rulerD -= limit;
            subD = Math.round(rulerD + part * i) + 0.5;
          }

          // odd lines are slighly longer
          const lineNum = (i % 2) ? 12 : 10;
          if (isX) {
            ctx.moveTo(subD, 15);
            ctx.lineTo(subD, lineNum);
          } else {
            ctx.moveTo(15, subD);
            ctx.lineTo(lineNum, subD);
          }
        }
        rulerD += bigInt;
      }
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
  }

  /**
  * @function module:SVGEditor.updateCanvas
  * @param {boolean} center
  * @param {module:math.XYObject} newCtr
  * @returns {void}
  */
  const updateCanvas = editor.updateCanvas = function (center, newCtr) {
    const zoom = svgCanvas.getZoom();
    const wArea = workarea;
    const cnvs = $('#svgcanvas');

    let w = workarea.width(), h = workarea.height();
    const wOrig = w, hOrig = h;
    const oldCtr = {
      x: wArea[0].scrollLeft + wOrig / 2,
      y: wArea[0].scrollTop + hOrig / 2
    };
    const multi = configObj.curConfig.canvas_expansion;
    w = Math.max(wOrig, svgCanvas.contentW * zoom * multi);
    h = Math.max(hOrig, svgCanvas.contentH * zoom * multi);

    if (w === wOrig && h === hOrig) {
      workarea.css('overflow', 'hidden');
    } else {
      workarea.css('overflow', 'scroll');
    }

    const oldCanY = cnvs.height() / 2;
    const oldCanX = cnvs.width() / 2;
    cnvs.width(w).height(h);
    const newCanY = h / 2;
    const newCanX = w / 2;
    const offset = svgCanvas.updateCanvas(w, h);

    const ratio = newCanX / oldCanX;

    const scrollX = w / 2 - wOrig / 2; // eslint-disable-line no-shadow
    const scrollY = h / 2 - hOrig / 2; // eslint-disable-line no-shadow

    if (!newCtr) {
      const oldDistX = oldCtr.x - oldCanX;
      const newX = newCanX + oldDistX * ratio;

      const oldDistY = oldCtr.y - oldCanY;
      const newY = newCanY + oldDistY * ratio;

      newCtr = {
        x: newX,
        y: newY
      };
    } else {
      newCtr.x += offset.x;
      newCtr.y += offset.y;
    }

    if (center) {
      // Go to top-left for larger documents
      if (svgCanvas.contentW > wArea.width()) {
        // Top-left
        workarea[0].scrollLeft = offset.x - 10;
        workarea[0].scrollTop = offset.y - 10;
      } else {
        // Center
        wArea[0].scrollLeft = scrollX;
        wArea[0].scrollTop = scrollY;
      }
    } else {
      wArea[0].scrollLeft = newCtr.x - wOrig / 2;
      wArea[0].scrollTop = newCtr.y - hOrig / 2;
    }
    if (configObj.curConfig.showRulers) {
      updateRulers(cnvs, zoom);
      workarea.scroll();
    }

    if (configObj.urldata.storagePrompt !== true && editor.storagePromptState === 'ignore') {
      $('#dialog_box').hide();
    }
  };

  /**
   * @fires module:svgcanvas.SvgCanvas#event:ext_toolButtonStateUpdate
   * @returns {void}
   */
  const updateToolButtonState = () => {
    const bNoFill = (svgCanvas.getColor('fill') === 'none');
    const bNoStroke = (svgCanvas.getColor('stroke') === 'none');
    const buttonsNeedingStroke = ['tool_fhpath', 'tool_line'];
    const buttonsNeedingFillAndStroke = [
      'tools_rect', 'tools_ellipse',
      'tool_text', 'tool_path'
    ];

    if (bNoStroke) {
      buttonsNeedingStroke.forEach((btn) => {
        // if btn is pressed, change to select button
        if ($id(btn).pressed) {
          clickSelect();
        }
        $(btn).disabled = true;
      });
    } else {
      buttonsNeedingStroke.forEach((btn) => {
        $id(btn).disabled = false;
      });
    }

    if (bNoStroke && bNoFill) {
      buttonsNeedingFillAndStroke.forEach((btn) => {
        // if btn is pressed, change to select button
        if ($id(btn).pressed) {
          clickSelect();
        }
        $(btn).disabled = true;
      });
    } else {
      buttonsNeedingFillAndStroke.forEach((btn) => {
        $id(btn).disabled = false;
      });
    }

    svgCanvas.runExtensions(
      'toolButtonStateUpdate',
      /** @type {module:svgcanvas.SvgCanvas#event:ext_toolButtonStateUpdate} */ {
        nofill: bNoFill,
        nostroke: bNoStroke
      }
    );
  };

  /**
  * Updates the toolbar (colors, opacity, etc) based on the selected element.
  * This function also updates the opacity and id elements that are in the
  * context panel.
  * @returns {void}
  */
  const updateToolbar = () => {
    let i, len;
    if (!Utils.isNullish(selectedElement)) {
      switch (selectedElement.tagName) {
      case 'use':
      case 'image':
      case 'foreignObject':
        break;
      case 'g':
      case 'a': {
        // Look for common styles
        const childs = selectedElement.getElementsByTagName('*');
        let gWidth = null;
        for (i = 0, len = childs.length; i < len; i++) {
          const swidth = childs[i].getAttribute('stroke-width');

          if (i === 0) {
            gWidth = swidth;
          } else if (gWidth !== swidth) {
            gWidth = null;
          }
        }

        $('#stroke_width').val(gWidth === null ? '' : gWidth);

        paintBox.fill.update(true);
        paintBox.stroke.update(true);

        break;
      } default: {
        paintBox.fill.update(true);
        paintBox.stroke.update(true);

        $('#stroke_width').val(selectedElement.getAttribute('stroke-width') || 1);
        $('#stroke_style').val(selectedElement.getAttribute('stroke-dasharray') || 'none');

        let attr = selectedElement.getAttribute('stroke-linejoin') || 'miter';

        if ($('#linejoin_' + attr).length) {
          setStrokeOpt($('#linejoin_' + attr)[0]);
        }

        attr = selectedElement.getAttribute('stroke-linecap') || 'butt';

        if ($('#linecap_' + attr).length) {
          setStrokeOpt($('#linecap_' + attr)[0]);
        }
      }
      }
    }

    // All elements including image and group have opacity
    if (!Utils.isNullish(selectedElement)) {
      const opacPerc = (selectedElement.getAttribute('opacity') || 1.0) * 100;
      $('#group_opacity').val(opacPerc);
      $('#opac_slider').slider('option', 'value', opacPerc);
      $id('elem_id').value = selectedElement.id;
      $id('elem_class').value = (selectedElement.getAttribute('class') !== null) ? selectedElement.getAttribute('class') : '';
    }

    updateToolButtonState();
  };

  /**
  *
  * @returns {void}
  */
  const updateWireFrame = () => {
    // Test support
    if (supportsNonSS) { return; }

    const rule = `
      #workarea.wireframe #svgcontent * {
        stroke-width: ${1 / svgCanvas.getZoom()}px;
      }
    `;
    $('#wireframe_rules').text(workarea.hasClass('wireframe') ? rule : '');
  };

  let curContext = '';

  /**
  * @param {string} [title=svgCanvas.getDocumentTitle()]
  * @returns {void}
  */
  const updateTitle = function (title) {
    title = title || svgCanvas.getDocumentTitle();
    const newTitle = document.querySelector('title').text + (title ? ': ' + title : '');

    // Remove title update with current context info, isn't really necessary
    // if (curContext) {
    //   new_title = new_title + curContext;
    // }
    $('title:first').text(newTitle);
  };

  // called when we've selected a different element
  /**
  *
  * @param {external:Window} win
  * @param {module:svgcanvas.SvgCanvas#event:selected} elems Array of elements that were selected
  * @listens module:svgcanvas.SvgCanvas#event:selected
  * @fires module:svgcanvas.SvgCanvas#event:ext_selectedChanged
  * @returns {void}
  */
  const selectedChanged = function (win, elems) {
    const mode = svgCanvas.getMode();
    if (mode === 'select') {
      clickSelect();
    }
    const isNode = mode === 'pathedit';
    // if elems[1] is present, then we have more than one element
    selectedElement = (elems.length === 1 || Utils.isNullish(elems[1]) ? elems[0] : null);
    multiselected = (elems.length >= 2 && !Utils.isNullish(elems[1]));
    if (!Utils.isNullish(selectedElement) && !isNode) {
      updateToolbar();
    } // if (!Utils.isNullish(elem))

    // Deal with pathedit mode
    togglePathEditMode(isNode, elems);
    updateContextPanel();
    svgCanvas.runExtensions('selectedChanged', /** @type {module:svgcanvas.SvgCanvas#event:ext_selectedChanged} */ {
      elems,
      selectedElement,
      multiselected
    });
  };

  // Call when part of element is in process of changing, generally
  // on mousemove actions like rotate, move, etc.
  /**
   * @param {external:Window} win
   * @param {module:svgcanvas.SvgCanvas#event:transition} elems
   * @listens module:svgcanvas.SvgCanvas#event:transition
   * @fires module:svgcanvas.SvgCanvas#event:ext_elementTransition
   * @returns {void}
   */
  const elementTransition = function (win, elems) {
    const mode = svgCanvas.getMode();
    const elem = elems[0];

    if (!elem) {
      return;
    }

    multiselected = (elems.length >= 2 && !Utils.isNullish(elems[1]));
    // Only updating fields for single elements for now
    if (!multiselected) {
      switch (mode) {
      case 'rotate': {
        const ang = svgCanvas.getRotationAngle(elem);
        $('#angle').val(ang);
        $('#tool_reorient').toggleClass('disabled', ang === 0);
        break;

      // TODO: Update values that change on move/resize, etc
      // } case 'select': {
      // } case 'resize': {
      //   break;
      // }
      }
      }
    }
    svgCanvas.runExtensions('elementTransition', /** @type {module:svgcanvas.SvgCanvas#event:ext_elementTransition} */ {
      elems
    });
  };

  // called when any element has changed
  /**
   * @param {external:Window} win
   * @param {module:svgcanvas.SvgCanvas#event:changed} elems
   * @listens module:svgcanvas.SvgCanvas#event:changed
   * @fires module:svgcanvas.SvgCanvas#event:ext_elementChanged
   * @returns {void}
   */
  const elementChanged = function (win, elems) {
    const mode = svgCanvas.getMode();
    if (mode === 'select') {
      clickSelect();
    }

    elems.forEach((elem) => {
      const isSvgElem = (elem && elem.tagName === 'svg');
      if (isSvgElem || svgCanvas.isLayer(elem)) {
        layersPanel.populateLayers();
        // if the element changed was the svg, then it could be a resolution change
        if (isSvgElem) {
          updateCanvas();
        }
      // Update selectedElement if element is no longer part of the image.
      // This occurs for the text elements in Firefox
      } else if (elem && selectedElement && Utils.isNullish(selectedElement.parentNode)) {
        // || elem && elem.tagName == "path" && !multiselected) { // This was added in r1430, but not sure why
        selectedElement = elem;
      }
    });

    editor.showSaveWarning = true;

    // we update the contextual panel with potentially new
    // positional/sizing information (we DON'T want to update the
    // toolbar here as that creates an infinite loop)
    // also this updates the history buttons

    // we tell it to skip focusing the text control if the
    // text element was previously in focus
    updateContextPanel();

    // In the event a gradient was flipped:
    if (selectedElement && mode === 'select') {
      paintBox.fill.update();
      paintBox.stroke.update();
    }

    svgCanvas.runExtensions('elementChanged', /** @type {module:svgcanvas.SvgCanvas#event:ext_elementChanged} */ {
      elems
    });
  };

  /**
   * @returns {void}
   */
  const zoomDone = () => {
    updateWireFrame();
    // updateCanvas(); // necessary?
  };

  /**
  * @typedef {PlainObject} module:SVGEditor.BBoxObjectWithFactor (like `DOMRect`)
  * @property {Float} x
  * @property {Float} y
  * @property {Float} width
  * @property {Float} height
  * @property {Float} [factor] Needed if width or height are 0
  * @property {Float} [zoom]
  * @see module:svgcanvas.SvgCanvas#event:zoomed
  */

  /**
  * @function module:svgcanvas.SvgCanvas#zoomChanged
  * @param {external:Window} win
  * @param {module:svgcanvas.SvgCanvas#event:zoomed} bbox
  * @param {boolean} autoCenter
  * @listens module:svgcanvas.SvgCanvas#event:zoomed
  * @returns {void}
  */
  const zoomChanged = svgCanvas.zoomChanged = function (win, bbox, autoCenter) {
    const scrbar = 15,
      // res = svgCanvas.getResolution(), // Currently unused
      wArea = workarea;
    // const canvasPos = $('#svgcanvas').position(); // Currently unused
    const zInfo = svgCanvas.setBBoxZoom(bbox, wArea.width() - scrbar, wArea.height() - scrbar);
    if (!zInfo) { return; }
    const zoomlevel = zInfo.zoom,
      bb = zInfo.bbox;

    if (zoomlevel < 0.001) {
      changeZoom(0.1);
      return;
    }

    $id('zoom').value = (svgCanvas.getZoom() * 100).toFixed(1);

    if (autoCenter) {
      updateCanvas();
    } else {
      updateCanvas(false, {x: bb.x * zoomlevel + (bb.width * zoomlevel) / 2, y: bb.y * zoomlevel + (bb.height * zoomlevel) / 2});
    }

    if (svgCanvas.getMode() === 'zoom' && bb.width) {
      // Go to select if a zoom box was drawn
      clickSelect();
    }

    zoomDone();
  };

  /**
  * @type {module}
  */
  const changeZoom = (value) => {
    switch (value) {
    case 'canvas':
    case 'selection':
    case 'layer':
    case 'content':
      zoomChanged(window, value);
      break;
    default:
    {
      const zoomlevel = Number(value) / 100;
      if (zoomlevel < 0.001) {
        value = 0.1;
        return;
      }
      const zoom = svgCanvas.getZoom();
      const wArea = workarea;

      zoomChanged(window, {
        width: 0,
        height: 0,
        // center pt of scroll position
        x: (wArea[0].scrollLeft + wArea.width() / 2) / zoom,
        y: (wArea[0].scrollTop + wArea.height() / 2) / zoom,
        zoom: zoomlevel
      }, true);
    }
    }
  };

  $('#cur_context_panel').delegate('a', 'click', (evt) => {
    const link = $(evt.currentTarget);
    if (link.attr('data-root')) {
      svgCanvas.leaveContext();
    } else {
      svgCanvas.setContext(link.text());
    }
    svgCanvas.clearSelection();
    return false;
  });

  /**
   * @param {external:Window} win
   * @param {module:svgcanvas.SvgCanvas#event:contextset} context
   * @listens module:svgcanvas.SvgCanvas#event:contextset
   * @returns {void}
   */
  const contextChanged = function (win, context) {
    let linkStr = '';
    if (context) {
      let str = '';
      linkStr = '<a href="#" data-root="y">' + svgCanvas.getCurrentDrawing().getCurrentLayerName() + '</a>';

      $(context).parentsUntil('#svgcontent > g').andSelf().each(() => {
        if (this.id) {
          str += ' > ' + this.id;
          linkStr += (this !== context) ? ` > <a href="#">${this.id}</a>` : ` > ${this.id}`;
        }
      });

      curContext = str;
    } else {
      curContext = null;
    }
    $('#cur_context_panel').toggle(Boolean(context)).html(linkStr);

    updateTitle();
  };

  /**
  * Makes sure the current selected paint is available to work with.
  * @returns {void}
  */
  const prepPaints = () => {
    paintBox.fill.prep();
    paintBox.stroke.prep();
  };

  /**
   * @param {external:Window} win
   * @param {module:svgcanvas.SvgCanvas#event:extension_added} ext
   * @listens module:svgcanvas.SvgCanvas#event:extension_added
   * @returns {Promise<void>|void} Resolves to `undefined`
   */
  const extAdded = async (win, ext) => {
    if (!ext) {
      return undefined;
    }
    let cbCalled = false;

    if (ext.langReady && editor.langChanged) { // We check for this since the "lang" pref could have been set by storage
      const lang = editor.pref('lang');
      await ext.langReady({lang});
    }

    /**
    *
    * @returns {void}
    */
    const runCallback = () => {
      if (ext.callback && !cbCalled) {
        cbCalled = true;
        ext.callback.call(editor);
      }
    };

    /**
    * @typedef {PlainObject} module:SVGEditor.ContextTool
    * @property {string} panel The ID of the existing panel to which the tool is being added. Required.
    * @property {string} id The ID of the actual tool element. Required.
    * @property {PlainObject<string, external:jQuery.Function>|PlainObject<"change", external:jQuery.Function>} events DOM event names keyed to associated functions. Example: `{change () { alert('Option was changed') } }`. "change" event is one specifically handled for the "button-select" type. Required.
    * @property {string} title The tooltip text that will appear when the user hovers over the tool. Required.
    * @property {"tool_button"|"select"|"button-select"|"input"|string} type The type of tool being added. Expected.
    * @property {PlainObject<string, string>} [options] List of options and their labels for select tools. Example: `{1: 'One', 2: 'Two', all: 'All' }`. Required by "select" tools.
    * @property {string} [container_id] The ID to be given to the tool's container element.
    * @property {string} [defval] Default value
    * @property {string|Integer} [colnum] Added as part of the option list class.
    * @property {string} [label] Label associated with the tool, visible in the UI
    * @property {Integer} [size] Value of the "size" attribute of the tool input
    */
    if (ext.context_tools) {
      $.each(ext.context_tools, function (i, tool) {
        // Add select tool
        const contId = tool.container_id ? (' id="' + tool.container_id + '"') : '';

        let panel = $('#' + tool.panel);
        // create the panel if it doesn't exist
        if (!panel.length) {
          panel = $('<div>', {id: tool.panel}).appendTo('#tools_top');
        }

        let html;
        // TODO: Allow support for other types, or adding to existing tool
        switch (tool.type) {
        case 'tool_button': {
          html = '<div class="tool_button">' + tool.id + '</div>';
          const div = $(html).appendTo(panel);
          if (tool.events) {
            $.each(tool.events, function (evt, func) {
              $(div).bind(evt, func);
            });
          }
          break;
        } case 'select': {
          html = '<label' + contId + '>' +
            '<select id="' + tool.id + '">';
          $.each(tool.options, function (val, text) {
            const sel = (val === tool.defval) ? ' selected' : '';
            html += '<option value="' + val + '"' + sel + '>' + text + '</option>';
          });
          html += '</select></label>';
          // Creates the tool, hides & adds it, returns the select element
          const sel = $(html).appendTo(panel).find('select');

          $.each(tool.events, function (evt, func) {
            $(sel).bind(evt, func);
          });
          break;
        } case 'button-select': {
          html = '<div id="' + tool.id + '" class="dropdown toolset" title="' + tool.title + '">' +
            '<div id="cur_' + tool.id + '" class="icon_label"></div><button></button></div>';

          const list = $('<ul id="' + tool.id + '_opts"></ul>').appendTo('#option_lists');

          if (tool.colnum) {
            list.addClass('optcols' + tool.colnum);
          }

          // Creates the tool, hides & adds it, returns the select element
          /* const dropdown = */ $(html).appendTo(panel).children();
          break;
        } case 'input': {
          html = '<label' + contId + '>' +
            '<span id="' + tool.id + '_label">' +
            tool.label + ':</span>' +
            '<input id="' + tool.id + '" title="' + tool.title +
            '" size="' + (tool.size || '4') +
            '" value="' + (tool.defval || '') + '" type="text"/></label>';

          // Creates the tool, hides & adds it, returns the select element

          // Add to given tool.panel
          const inp = $(html).appendTo(panel).find('input');

          if (tool.events) {
            $.each(tool.events, function (evt, func) {
              inp.bind(evt, func);
            });
          }
          break;
        } default:
          break;
        }
      });
    }

    if (ext.events) {
      $id(ext.events.id).addEventListener('click', () => {
        if (updateLeftPanel(ext.events.id)) {
          ext.events.click();
        }
      });
    }
    return runCallback();
  };

  /**
  * @param {string} color
  * @param {Float} opac
  * @param {string} type
  * @returns {module:jGraduate~Paint}
  */
  const getPaint = function (color, opac, type) {
    // update the editor's fill paint
    const opts = {alpha: opac};
    if (color.startsWith('url(#')) {
      let refElem = svgCanvas.getRefElem(color);
      refElem = (refElem) ? refElem.cloneNode(true) : $('#' + type + '_color defs *')[0];
      opts[refElem.tagName] = refElem;
    } else if (color.startsWith('#')) {
      opts.solidColor = color.substr(1);
    } else {
      opts.solidColor = 'none';
    }
    return new $.jGraduate.Paint(opts);
  };

  // bind the selected event to our function that handles updates to the UI
  svgCanvas.bind('selected', selectedChanged);
  svgCanvas.bind('transition', elementTransition);
  svgCanvas.bind('changed', elementChanged);
  svgCanvas.bind('saved', saveHandler);
  svgCanvas.bind('exported', exportHandler);
  svgCanvas.bind('exportedPDF', function (win, data) {
    if (!data.output) { // Ignore Chrome
      return;
    }
    const {exportWindowName} = data;
    if (exportWindowName) {
      exportWindow = window.open('', exportWindowName); // A hack to get the window via JSON-able name without opening a new one
    }
    if (!exportWindow || exportWindow.closed) {
      /* await */ $.alert(uiStrings.notification.popupWindowBlocked);
      return;
    }
    exportWindow.location.href = data.output;
  });
  svgCanvas.bind('zoomed', zoomChanged);
  svgCanvas.bind('zoomDone', zoomDone);
  svgCanvas.bind(
    'updateCanvas',
    /**
     * @param {external:Window} win
     * @param {PlainObject} centerInfo
     * @param {false} centerInfo.center
     * @param {module:math.XYObject} centerInfo.newCtr
     * @listens module:svgcanvas.SvgCanvas#event:updateCanvas
     * @returns {void}
     */
    function (win, {center, newCtr}) {
      updateCanvas(center, newCtr);
    }
  );
  svgCanvas.bind('contextset', contextChanged);
  svgCanvas.bind('extension_added', extAdded);
  svgCanvas.textActions.setInputElem($('#text')[0]);

  setBackground(editor.pref('bkgd_color'), editor.pref('bkgd_url'));

  // update resolution option with actual resolution
  const res = svgCanvas.getResolution();
  if (configObj.curConfig.baseUnit !== 'px') {
    res.w = convertUnit(res.w) + configObj.curConfig.baseUnit;
    res.h = convertUnit(res.h) + configObj.curConfig.baseUnit;
  }
  $('#se-img-prop').attr('dialog', 'close');
  $('#se-img-prop').attr('title', svgCanvas.getDocumentTitle());
  $('#se-img-prop').attr('width', res.w);
  $('#se-img-prop').attr('height', res.h);
  $('#se-img-prop').attr('save', editor.pref('img_save'));
  /**
  * @type {module}
  */
  const changeRectRadius = function (e) {
    svgCanvas.setRectRadius(e.target.value);
  };

  /**
  * @type {module}
  */
  const changeFontSize = function (e) {
    svgCanvas.setFontSize(e.target.value);
  };

  /**
  * @type {module}
  */
  const changeStrokeWidth = function (e) {
    let val = e.target.value;
    if (val === 0 && selectedElement && ['line', 'polyline'].includes(selectedElement.nodeName)) {
      val = e.target.value = 1;
    }
    svgCanvas.setStrokeWidth(val);
  };

  /**
  * @type {module}
  */
  const changeRotationAngle = (e) => {
    svgCanvas.setRotationAngle(e.target.value);
    $('#tool_reorient').toggleClass('disabled', Number.parseInt(e.target.value) === 0);
  };

  /**
  * @param {PlainObject} ctl
  * @param {string} [val=ctl.value]
  * @returns {void}
  */
  const changeOpacity = function (ctl, val) {
    if (Utils.isNullish(val)) { val = ctl.value; }
    $('#group_opacity').val(val);
    if (!ctl || !ctl.handle) {
      $('#opac_slider').slider('option', 'value', val);
    }
    svgCanvas.setOpacity(val / 100);
  };

  /**
  * @param {PlainObject} e
  * @returns {void}
  */
  const changeBlur = (e) => {
    svgCanvas.setBlur(e.target.value / 10, true);
  };

  $('#stroke_style').change((evt) => {
    svgCanvas.setStrokeAttr('stroke-dasharray', $(evt.currentTarget).val());
  });

  $('#stroke_linejoin').change((evt) => {
    svgCanvas.setStrokeAttr('stroke-linejoin', $(evt.currentTarget).val());
  });

  // Lose focus for select elements when changed (Allows keyboard shortcuts to work better)
  $('select').change((evt) => { $(evt.currentTarget).blur(); });

  // fired when user wants to move elements to another layer
  let promptMoveLayerOnce = false;
  $('#selLayerNames').change(async (evt) => {
    const destLayer = evt.currentTarget.options[evt.currentTarget.selectedIndex].value;
    const confirmStr = uiStrings.notification.QmoveElemsToLayer.replace('%s', destLayer);
    /**
    * @param {boolean} ok
    * @returns {void}
    */
    const moveToLayer = function (ok) {
      if (!ok) { return; }
      promptMoveLayerOnce = true;
      svgCanvas.moveSelectedToLayer(destLayer);
      svgCanvas.clearSelection();
      layersPanel.populateLayers();
    };
    if (destLayer) {
      if (promptMoveLayerOnce) {
        moveToLayer(true);
      } else {
        const ok = await $.confirm(confirmStr);
        if (!ok) {
          return;
        }
        moveToLayer(true);
      }
    }
  });

  $('#font_family').change((evt) => {
    svgCanvas.setFontFamily(evt.currentTarget.value);
  });

  $('#seg_type').change((evt) => {
    svgCanvas.setSegType($(evt.currentTarget).val());
  });

  $('#text').bind('keyup input', (evt) => {
    svgCanvas.setTextContent(evt.currentTarget.value);
  });

  $('#image_url').change((evt) => {
    setImageURL(evt.currentTarget.value);
  });

  $('#link_url').change((evt) => {
    if (evt.currentTarget.value.length) {
      svgCanvas.setLinkURL(evt.currentTarget.value);
    } else {
      svgCanvas.removeHyperlink();
    }
  });

  $('#g_title').change((evt) => {
    svgCanvas.setGroupTitle(evt.currentTarget.value);
  });

  const attrChanger = function (e) {
    const attr = e.target.getAttribute('data-attr');
    let val = e.target.value;
    const valid = isValidUnit(attr, val, selectedElement);

    if (!valid) {
      e.target.value = selectedElement.getAttribute(attr);
      /* await */ $.alert(uiStrings.notification.invalidAttrValGiven);
      return false;
    }

    if (attr !== 'id' && attr !== 'class') {
      if (isNaN(val)) {
        val = svgCanvas.convertToNum(attr, val);
      } else if (configObj.curConfig.baseUnit !== 'px') {
        // Convert unitless value to one with given unit

        const unitData = getTypeMap();

        if (selectedElement[attr] || svgCanvas.getMode() === 'pathedit' || attr === 'x' || attr === 'y') {
          val *= unitData[configObj.curConfig.baseUnit];
        }
      }
    }

    // if the user is changing the id, then de-select the element first
    // change the ID, then re-select it with the new ID
    if (attr === 'id') {
      const elem = selectedElement;
      svgCanvas.clearSelection();
      elem.id = val;
      svgCanvas.addToSelection([elem], true);
    } else {
      svgCanvas.changeSelectedAttribute(attr, val);
    }
    return true;
  };

  $('.attr_changer').change((evt) => {
    const attr = evt.currentTarget.getAttribute('data-attr');
    let val = evt.currentTarget.value;
    const valid = isValidUnit(attr, val, selectedElement);

    if (!valid) {
      evt.currentTarget.value = selectedElement.getAttribute(attr);
      /* await */ $.alert(uiStrings.notification.invalidAttrValGiven);
      return false;
    }

    if (attr !== 'id' && attr !== 'class') {
      if (isNaN(val)) {
        val = svgCanvas.convertToNum(attr, val);
      } else if (configObj.curConfig.baseUnit !== 'px') {
        // Convert unitless value to one with given unit

        const unitData = getTypeMap();

        if (selectedElement[attr] || svgCanvas.getMode() === 'pathedit' || attr === 'x' || attr === 'y') {
          val *= unitData[configObj.curConfig.baseUnit];
        }
      }
    }

    // if the user is changing the id, then de-select the element first
    // change the ID, then re-select it with the new ID
    if (attr === 'id') {
      const elem = selectedElement;
      svgCanvas.clearSelection();
      elem.id = val;
      svgCanvas.addToSelection([elem], true);
    } else {
      svgCanvas.changeSelectedAttribute(attr, val);
    }
    evt.currentTarget.blur();
    return true;
  });

  (function () {
    const wArea = workarea[0];

    let lastX = null, lastY = null,
      panning = false, keypan = false;

    $('#svgcanvas').bind('mousemove mouseup', function (evt) {
      if (panning === false) { return true; }

      wArea.scrollLeft -= (evt.clientX - lastX);
      wArea.scrollTop -= (evt.clientY - lastY);

      lastX = evt.clientX;
      lastY = evt.clientY;

      if (evt.type === 'mouseup') { panning = false; }
      return false;
    }).mousedown(function (evt) {
      if (evt.button === 1 || keypan === true) {
        panning = true;
        lastX = evt.clientX;
        lastY = evt.clientY;
        return false;
      }
      return true;
    });

    $(window).mouseup(() => {
      panning = false;
    });

    $(document).bind('keydown', 'space', function (evt) {
      svgCanvas.spaceKey = keypan = true;
      evt.preventDefault();
    }).bind('keyup', 'space', function (evt) {
      evt.preventDefault();
      svgCanvas.spaceKey = keypan = false;
    }).bind('keydown', 'shift', function (evt) {
      if (svgCanvas.getMode() === 'zoom') {
        workarea.css('cursor', zoomOutIcon);
      }
    }).bind('keyup', 'shift', function (evt) {
      if (svgCanvas.getMode() === 'zoom') {
        workarea.css('cursor', zoomInIcon);
      }
    });

    /**
     * @function module:SVGEditor.setPanning
     * @param {boolean} active
     * @returns {void}
     */
    editor.setPanning = function (active) {
      svgCanvas.spaceKey = keypan = active;
    };
  }());

  (function () {
    const button = $('#main_icon');
    const overlay = $('#main_icon span');
    const list = $('#main_menu');

    let onButton = false;
    let height = 0;
    let jsHover = true;
    let setClick = false;

    /*
    // Currently unused
    const hideMenu = () => {
      list.fadeOut(200);
    };
    */

    $(window).mouseup(function (evt) {
      if (!onButton) {
        button.removeClass('buttondown');
        // do not hide if it was the file input as that input needs to be visible
        // for its change event to fire
        if (evt.target.tagName !== 'INPUT') {
          list.fadeOut(200);
        } else if (!setClick) {
          setClick = true;
          $(evt.target).click(() => {
            list.css('margin-left', '-9999px').show();
          });
        }
      }
      onButton = false;
    }).mousedown(function (evt) {
      // $('.contextMenu').hide();
      const islib = $(evt.target).closest('.contextMenu').length;
      if (!islib) {
        $('.contextMenu').fadeOut(250);
      }
    });

    overlay.bind('mousedown', () => {
      if (!button.hasClass('buttondown')) {
        // Margin must be reset in case it was changed before;
        list.css('margin-left', 0).show();
        if (!height) {
          height = list.height();
        }
        // Using custom animation as slideDown has annoying 'bounce effect'
        list.css('height', 0).animate({
          height
        }, 200);
        onButton = true;
      } else {
        list.fadeOut(200);
      }
      button.toggleClass('buttondown buttonup');
    }).hover(() => {
      onButton = true;
    }).mouseout(() => {
      onButton = false;
    });

    const listItems = $('#main_menu li');

    // Check if JS method of hovering needs to be used (Webkit bug)
    listItems.mouseover(function () {
      jsHover = ($(this).css('background-color') === 'rgba(0, 0, 0, 0)');

      listItems.unbind('mouseover');
      if (jsHover) {
        listItems.mouseover(() => {
          this.style.backgroundColor = '#FFC';
        }).mouseout((evt) => {
          evt.currentTarget.style.backgroundColor = 'transparent';
          return true;
        });
      }
    });
  }());
  // Made public for UI customization.
  // TODO: Group UI functions into a public editor.ui interface.
  /**
   * See {@link http://api.jquery.com/bind/#bind-eventType-eventData-handler}.
   * @callback module:SVGEditor.DropDownCallback
   * @param {external:jQuery.Event} ev See {@link http://api.jquery.com/Types/#Event}
   * @listens external:jQuery.Event
   * @returns {void|boolean} Calls `preventDefault()` and `stopPropagation()`
  */
  /**
   * @function module:SVGEditor.addDropDown
   * @param {Element|string} elem DOM Element or selector
   * @param {module:SVGEditor.DropDownCallback} callback Mouseup callback
   * @param {boolean} dropUp
   * @returns {void}
  */
  editor.addDropDown = function (elem, callback, dropUp) {
    if (!$(elem).length) { return; } // Quit if called on non-existent element
    const button = $(elem).find('button');
    const list = $(elem).find('ul').attr('id', $(elem)[0].id + '-list');
    if (dropUp) {
      $(elem).addClass('dropup');
    } else {
      // Move list to place where it can overflow container
      $('#option_lists').append(list);
    }
    list.find('li').bind('mouseup', callback);

    let onButton = false;
    $(window).mouseup(function (evt) {
      if (!onButton) {
        button.removeClass('down');
        list.hide();
      }
      onButton = false;
    });

    button.bind('mousedown', () => {
      if (!button.hasClass('down')) {
        if (!dropUp) {
          const pos = $(elem).position();
          list.css({
            top: pos.top + 24,
            left: pos.left - 10
          });
        }
        list.show();
        onButton = true;
      } else {
        list.hide();
      }
      button.toggleClass('down');
    }).hover(() => {
      onButton = true;
    }).mouseout(() => {
      onButton = false;
    });
  };

  editor.addDropDown('#font_family_dropdown', () => {
    $('#font_family').val($(this).text()).change();
  });

  editor.addDropDown('#opacity_dropdown', () => {
    if ($(this).find('div').length) { return; }
    const perc = Number.parseInt($(this).text().split('%')[0]);
    changeOpacity(false, perc);
  }, true);

  // For slider usage, see: http://jqueryui.com/demos/slider/
  $('#opac_slider').slider({
    start () {
      $('#opacity_dropdown li:not(.special)').hide();
    },
    stop () {
      $('#opacity_dropdown li').show();
      $(window).mouseup();
    },
    slide (evt, ui) {
      changeOpacity(ui);
    }
  });

  /*
  addAltDropDown('#stroke_linecap', '#linecap_opts', () => {
    setStrokeOpt(this, true);
  }, {dropUp: true});

  addAltDropDown('#stroke_linejoin', '#linejoin_opts', () => {
    setStrokeOpt(this, true);
  }, {dropUp: true});

  addAltDropDown('#tool_position', '#position_opts', () => {
    const letter = this.id.replace('tool_pos', '').charAt(0);
    svgCanvas.alignSelectedElements(letter, 'page');
  }, {multiclick: true});
  */

  // Unfocus text input when workarea is mousedowned.
  (function () {
    let inp;
    /**
    *
    * @returns {void}
    */
    const unfocus = () => {
      $(inp).blur();
    };

    $('#svg_editor').find('button, select, input:not(#text)').focus(() => {
      inp = this;
      uiContext = 'toolbars';
      workarea.mousedown(unfocus);
    }).blur(() => {
      uiContext = 'canvas';
      workarea.unbind('mousedown', unfocus);
      // Go back to selecting text if in textedit mode
      if (svgCanvas.getMode() === 'textedit') {
        $('#text').focus();
      }
    });
  }());

  /**
  *
  * @returns {void}
  */
  const clickFHPath = () => {
    if (updateLeftPanel('tool_fhpath')) {
      svgCanvas.setMode('fhpath');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickLine = () => {
    if (updateLeftPanel('tool_line')) {
      svgCanvas.setMode('line');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickSquare = () => {
    if (updateLeftPanel('tool_square')) {
      svgCanvas.setMode('square');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickRect = () => {
    if (updateLeftPanel('tool_rect')) {
      svgCanvas.setMode('rect');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickFHRect = () => {
    if (updateLeftPanel('tool_fhrect')) {
      svgCanvas.setMode('fhrect');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickCircle = () => {
    if (updateLeftPanel('tool_circle')) {
      svgCanvas.setMode('circle');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickEllipse = () => {
    if (updateLeftPanel('tool_ellipse')) {
      svgCanvas.setMode('ellipse');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickFHEllipse = () => {
    if (updateLeftPanel('tool_fhellipse')) {
      svgCanvas.setMode('fhellipse');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickImage = () => {
    if (updateLeftPanel('tool_image')) {
      svgCanvas.setMode('image');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickZoom = () => {
    if (updateLeftPanel('tool_zoom')) {
      svgCanvas.setMode('zoom');
      workarea.css('cursor', zoomInIcon);
    }
  };

  /**
  * @param {Float} multiplier
  * @returns {void}
  */
  const zoomImage = function (multiplier) {
    const resolution = svgCanvas.getResolution();
    multiplier = multiplier ? resolution.zoom * multiplier : 1;
    // setResolution(res.w * multiplier, res.h * multiplier, true);
    $id('zoom').value = (multiplier * 100).toFixed(1);
    svgCanvas.setZoom(multiplier);
    zoomDone();
    updateCanvas(true);
  };

  /**
  *
  * @returns {void}
  */
  const dblclickZoom = () => {
    if (updateLeftPanel('tool_zoom')) {
      zoomImage();
      clickSelect();
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickText = () => {
    if (updateLeftPanel('tool_text')) {
      svgCanvas.setMode('text');
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickPath = () => {
    if (updateLeftPanel('tool_path')) {
      svgCanvas.setMode('path');
    }
  };

  /**
  * Delete is a contextual tool that only appears in the ribbon if
  * an element has been selected.
  * @returns {void}
  */
  const deleteSelected = () => {
    if (!Utils.isNullish(selectedElement) || multiselected) {
      svgCanvas.deleteSelectedElements();
    }
  };

  /**
  *
  * @returns {void}
  */
  const cutSelected = () => {
    if (!Utils.isNullish(selectedElement) || multiselected) {
      svgCanvas.cutSelectedElements();
    }
  };

  /**
  *
  * @returns {void}
  */
  const copySelected = () => {
    if (!Utils.isNullish(selectedElement) || multiselected) {
      svgCanvas.copySelectedElements();
    }
  };

  /**
  *
  * @returns {void}
  */
  const pasteInCenter = () => {
    const zoom = svgCanvas.getZoom();
    const x = (workarea[0].scrollLeft + workarea.width() / 2) / zoom - svgCanvas.contentW;
    const y = (workarea[0].scrollTop + workarea.height() / 2) / zoom - svgCanvas.contentH;
    svgCanvas.pasteElements('point', x, y);
  };

  /**
  *
  * @returns {void}
  */
  const moveToTopSelected = () => {
    if (!Utils.isNullish(selectedElement)) {
      svgCanvas.moveToTopSelectedElement();
    }
  };

  /**
  *
  * @returns {void}
  */
  const moveToBottomSelected = () => {
    if (!Utils.isNullish(selectedElement)) {
      svgCanvas.moveToBottomSelectedElement();
    }
  };

  /**
  * @param {"Up"|"Down"} dir
  * @returns {void}
  */
  const moveUpDownSelected = function (dir) {
    if (!Utils.isNullish(selectedElement)) {
      svgCanvas.moveUpDownSelected(dir);
    }
  };

  /**
  *
  * @returns {void}
  */
  const convertToPath = () => {
    if (!Utils.isNullish(selectedElement)) {
      svgCanvas.convertToPath();
    }
  };

  /**
  *
  * @returns {void}
  */
  const reorientPath = () => {
    if (!Utils.isNullish(selectedElement)) {
      path.reorient();
    }
  };

  /**
  *
  * @returns {Promise<void>} Resolves to `undefined`
  */
  const makeHyperlink = async () => {
    if (!Utils.isNullish(selectedElement) || multiselected) {
      const url = await $.prompt(uiStrings.notification.enterNewLinkURL, 'http://');
      if (url) {
        svgCanvas.makeHyperlink(url);
      }
    }
  };

  /**
  * @param {Float} dx
  * @param {Float} dy
  * @returns {void}
  */
  const moveSelected = function (dx, dy) {
    if (!Utils.isNullish(selectedElement) || multiselected) {
      if (configObj.curConfig.gridSnapping) {
        // Use grid snap value regardless of zoom level
        const multi = svgCanvas.getZoom() * configObj.curConfig.snappingStep;
        dx *= multi;
        dy *= multi;
      }
      svgCanvas.moveSelectedElements(dx, dy);
    }
  };

  /**
  *
  * @returns {void}
  */
  const linkControlPoints = () => {
    const linked = $id('tool_node_link').pressed;
    $id('tool_node_link').pressed = !linked;
    path.linkControlPoints(linked);
  };

  /**
  *
  * @returns {void}
  */
  const clonePathNode = () => {
    if (path.getNodePoint()) {
      path.clonePathNode();
    }
  };

  /**
  *
  * @returns {void}
  */
  const deletePathNode = () => {
    if (path.getNodePoint()) {
      path.deletePathNode();
    }
  };

  /**
  *
  * @returns {void}
  */
  const addSubPath = () => {
    const button = $('#tool_add_subpath');
    const sp = !button.hasClass('pressed');
    button.pressed = sp;
    // button.toggleClass('push_button_pressed tool_button');
    path.addSubPath(sp);
  };

  /**
  *
  * @returns {void}
  */
  const opencloseSubPath = () => {
    path.opencloseSubPath();
  };

  /**
  *
  * @returns {void}
  */
  const selectNext = () => {
    svgCanvas.cycleElement(1);
  };

  /**
  *
  * @returns {void}
  */
  const selectPrev = () => {
    svgCanvas.cycleElement(0);
  };

  /**
  * @param {0|1} cw
  * @param {Integer} step
  * @returns {void}
  */
  const rotateSelected = function (cw, step) {
    if (Utils.isNullish(selectedElement) || multiselected) { return; }
    if (!cw) { step *= -1; }
    const angle = Number.parseFloat($('#angle').val()) + step;
    svgCanvas.setRotationAngle(angle);
    updateContextPanel();
  };

  /**
   * @fires module:svgcanvas.SvgCanvas#event:ext_onNewDocument
   * @returns {Promise<void>} Resolves to `undefined`
   */
  const clickClear = async () => {
    const [x, y] = configObj.curConfig.dimensions;
    const ok = await $.confirm(uiStrings.notification.QwantToClear);
    if (!ok) {
      return;
    }
    clickSelect();
    svgCanvas.clear();
    svgCanvas.setResolution(x, y);
    updateCanvas(true);
    zoomImage();
    layersPanel.populateLayers();
    updateContextPanel();
    prepPaints();
    svgCanvas.runExtensions('onNewDocument');
  };

  /**
  *
  * @returns {false}
  */
  const clickBold = () => {
    svgCanvas.setBold(!svgCanvas.getBold());
    updateContextPanel();
    return false;
  };

  /**
  *
  * @returns {false}
  */
  const clickItalic = () => {
    svgCanvas.setItalic(!svgCanvas.getItalic());
    updateContextPanel();
    return false;
  };

  /**
  *
  * @returns {void}
  */
  const clickSave = () => {
    // In the future, more options can be provided here
    const saveOpts = {
      images: editor.pref('img_save'),
      round_digits: 6
    };
    svgCanvas.save(saveOpts);
  };

  let loadingURL;
  /**
  *
  * @returns {Promise<void>} Resolves to `undefined`
  */
  const clickExport = async () => {
    const imgType = await $.select('Select an image type for export: ', [
      // See http://kangax.github.io/jstests/toDataUrl_mime_type_test/ for a useful list of MIME types and browser support
      // 'ICO', // Todo: Find a way to preserve transparency in SVG-Edit if not working presently and do full packaging for x-icon; then switch back to position after 'PNG'
      'PNG',
      'JPEG', 'BMP', 'WEBP', 'PDF'
    ], () => {
      const sel = $(this);
      if (sel.val() === 'JPEG' || sel.val() === 'WEBP') {
        if (!$('#image-slider').length) {
          $(`<div><label>${uiStrings.ui.quality}
              <input id="image-slider"
                type="range" min="1" max="100" value="92" />
            </label></div>`).appendTo(sel.parent());
        }
      } else {
        $('#image-slider').parent().remove();
      }
    }); // todo: replace hard-coded msg with uiStrings.notification.
    if (!imgType) {
      return;
    }
    // Open placeholder window (prevents popup)
    let exportWindowName;

    /**
     *
     * @returns {void}
     */
    function openExportWindow () {
      const {loadingImage} = uiStrings.notification;
      if (configObj.curConfig.exportWindowType === 'new') {
        editor.exportWindowCt++;
      }
      exportWindowName = configObj.curConfig.canvasName + editor.exportWindowCt;
      let popHTML, popURL;
      if (loadingURL) {
        popURL = loadingURL;
      } else {
        popHTML = `<!DOCTYPE html><html>
          <head>
            <meta charset="utf-8">
            <title>${loadingImage}</title>
          </head>
          <body><h1>${loadingImage}</h1></body>
        <html>`;
        if (typeof URL !== 'undefined' && URL.createObjectURL) {
          const blob = new Blob([popHTML], {type: 'text/html'});
          popURL = URL.createObjectURL(blob);
        } else {
          popURL = 'data:text/html;base64;charset=utf-8,' + Utils.encode64(popHTML);
        }
        loadingURL = popURL;
      }
      exportWindow = window.open(popURL, exportWindowName);
    }
    const chrome = isChrome();
    if (imgType === 'PDF') {
      if (!customExportPDF && !chrome) {
        openExportWindow();
      }
      svgCanvas.exportPDF(exportWindowName);
    } else {
      if (!customExportImage) {
        openExportWindow();
      }
      const quality = Number.parseInt($('#image-slider').val()) / 100;
      /* const results = */ await svgCanvas.rasterExport(imgType, quality, exportWindowName);
    }
  };

  /**
   * By default, svgCanvas.open() is a no-op. It is up to an extension
   *  mechanism (opera widget, etc.) to call `setCustomHandlers()` which
   *  will make it do something.
   * @returns {void}
   */
  const clickOpen = () => {
    svgCanvas.open();
  };

  /**
  *
  * @returns {void}
  */
  const clickImport = () => {
    /* empty fn */
  };

  /**
  *
  * @returns {void}
  */
  const clickUndo = () => {
    if (undoMgr.getUndoStackSize() > 0) {
      undoMgr.undo();
      layersPanel.populateLayers();
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickRedo = () => {
    if (undoMgr.getRedoStackSize() > 0) {
      undoMgr.redo();
      layersPanel.populateLayers();
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickGroup = () => {
    // group
    if (multiselected) {
      svgCanvas.groupSelectedElements();
    // ungroup
    } else if (selectedElement) {
      svgCanvas.ungroupSelectedElement();
    }
  };

  /**
  *
  * @returns {void}
  */
  const clickClone = () => {
    svgCanvas.cloneSelectedElements(20, 20);
  };

  /**
  * @param {string} pos indicate the alignment relative to top, bottom, middle etc..
  * @returns {void}
  */
  const clickAlign = (pos) => {
    svgCanvas.alignSelectedElements(pos, $('#align_relative_to').val());
  };

  /**
  *
  * @returns {void}
  */
  const clickWireframe = () => {
    $id('tool_wireframe').pressed = !$id('tool_wireframe').pressed;
    workarea.toggleClass('wireframe');

    if (supportsNonSS) { return; }
    const wfRules = $('#wireframe_rules');
    if (!wfRules.length) {
      /* wfRules = */ $('<style id="wireframe_rules"></style>').appendTo('head');
    } else {
      wfRules.empty();
    }

    updateWireFrame();
  };

  const handlePalette = (e) => {
    e.preventDefault();
    // shift key or right click for stroke
    const {picker, color} = e.detail;
    // Webkit-based browsers returned 'initial' here for no stroke
    const paint = color === 'none' ? new $.jGraduate.Paint() : new $.jGraduate.Paint({alpha: 100, solidColor: color.substr(1)});
    paintBox[picker].setPaint(paint);
    svgCanvas.setColor(picker, color);
    if (color !== 'none' && svgCanvas.getPaintOpacity(picker) !== 1) {
      svgCanvas.setPaintOpacity(picker, 1.0);
    }
    updateToolButtonState();
  };

  let docprops = false;
  let preferences = false;

  /**
  *
  * @returns {void}
  */
  const showDocProperties = () => {
    if (docprops) { return; }
    docprops = true;
    const $imgDialog = document.getElementById('se-img-prop');

    // update resolution option with actual resolution
    const resolution = svgCanvas.getResolution();
    if (configObj.curConfig.baseUnit !== 'px') {
      resolution.w = convertUnit(resolution.w) + configObj.curConfig.baseUnit;
      resolution.h = convertUnit(resolution.h) + configObj.curConfig.baseUnit;
    }
    $imgDialog.setAttribute('save', editor.pref('img_save'));
    $imgDialog.setAttribute('width', resolution.w);
    $imgDialog.setAttribute('height', resolution.h);
    $imgDialog.setAttribute('title', svgCanvas.getDocumentTitle());
    $imgDialog.setAttribute('dialog', 'open');
  };

  /**
  *
  * @returns {void}
  */
  const showPreferences = () => {
    if (preferences) { return; }
    preferences = true;
    const $editDialog = document.getElementById('se-edit-prefs');
    $('#main_menu').hide();
    // Update background color with current one
    const canvasBg = configObj.curPrefs.bkgd_color;
    const url = editor.pref('bkgd_url');
    if (url) {
      $editDialog.setAttribute('bgurl', url);
    }
    $editDialog.setAttribute('gridsnappingon', configObj.curConfig.gridSnapping);
    $editDialog.setAttribute('gridsnappingstep', configObj.curConfig.snappingStep);
    $editDialog.setAttribute('gridcolor', configObj.curConfig.gridColor);
    $editDialog.setAttribute('canvasbg', canvasBg);
    $editDialog.setAttribute('dialog', 'open');
  };

  /**
  *
  * @returns {void}
  */
  const openHomePage = () => {
    window.open(homePage, '_blank');
  };

  /**
  *
  * @returns {void}
  */
  const hideSourceEditor = () => {
    $('#svg_source_editor').hide();
    editingsource = false;
    $('#svg_source_textarea').blur();
  };

  /**
  *
  * @returns {Promise<void>} Resolves to `undefined`
  */
  const saveSourceEditor = async () => {
    if (!editingsource) { return; }

    const saveChanges = () => {
      svgCanvas.clearSelection();
      hideSourceEditor();
      zoomImage();
      layersPanel.populateLayers();
      updateTitle();
      prepPaints();
    };

    if (!svgCanvas.setSvgString($('#svg_source_textarea').val())) {
      const ok = await $.confirm(uiStrings.notification.QerrorsRevertToSource);
      if (!ok) {
        return;
      }
      saveChanges();
      return;
    }
    saveChanges();
    clickSelect();
  };

  /**
  *
  * @returns {void}
  */
  const hideDocProperties = () => {
    const $imgDialog = document.getElementById('se-img-prop');
    $imgDialog.setAttribute('dialog', 'close');
    $imgDialog.setAttribute('save', editor.pref('img_save'));
    docprops = false;
  };

  /**
  *
  * @returns {void}
  */
  const hidePreferences = () => {
    const $editDialog = document.getElementById('se-edit-prefs');
    $editDialog.setAttribute('dialog', 'close');
    preferences = false;
  };

  /**
  * @param {Event} e
  * @returns {boolean} Whether there were problems saving the document properties
  */
  const saveDocProperties = function (e) {
    // set title
    const {title, w, h, save} = e.detail;
    // set document title
    svgCanvas.setDocumentTitle(title);

    if (w !== 'fit' && !isValidUnit('width', w)) {
      /* await */ $.alert(uiStrings.notification.invalidAttrValGiven);
      return false;
    }
    if (h !== 'fit' && !isValidUnit('height', h)) {
      /* await */ $.alert(uiStrings.notification.invalidAttrValGiven);
      return false;
    }
    if (!svgCanvas.setResolution(w, h)) {
      /* await */ $.alert(uiStrings.notification.noContentToFitTo);
      return false;
    }
    // Set image save option
    editor.pref('img_save', save);
    updateCanvas();
    hideDocProperties();
    return true;
  };

  /**
  * Save user preferences based on current values in the UI.
  * @param {Event} e
  * @function module:SVGEditor.savePreferences
  * @returns {Promise<void>}
  */
  const savePreferences = editor.savePreferences = async function (e) {
    const {lang, bgcolor, bgurl, gridsnappingon, gridsnappingstep, gridcolor, showrulers, baseunit} = e.detail;
    // Set background
    setBackground(bgcolor, bgurl);

    // set language
    if (lang && lang !== editor.pref('lang')) {
      const {langParam, langData} = await editor.putLocale(lang, goodLangs);
      await setLang(langParam, langData);
    }

    // set grid setting
    configObj.curConfig.gridSnapping = gridsnappingon;
    configObj.curConfig.snappingStep = gridsnappingstep;
    configObj.curConfig.gridColor = gridcolor;
    configObj.curConfig.showRulers = showrulers;

    $('#rulers').toggle(configObj.curConfig.showRulers);
    if (configObj.curConfig.showRulers) { updateRulers(); }
    configObj.curConfig.baseUnit = baseunit;

    svgCanvas.setConfig(configObj.curConfig);
    updateCanvas();
    hidePreferences();
  };

  /**
  *
  * @returns {Promise<void>} Resolves to `undefined`
  */
  const cancelOverlays = async () => {
    $('#dialog_box').hide();
    if (!editingsource && !docprops && !preferences) {
      if (curContext) {
        svgCanvas.leaveContext();
      }
      return;
    }

    if (editingsource) {
      if (origSource !== $('#svg_source_textarea').val()) {
        const ok = await $.confirm(uiStrings.notification.QignoreSourceChanges);
        if (ok) {
          hideSourceEditor();
        }
      } else {
        hideSourceEditor();
      }
    }
  };

  const winWh = {width: $(window).width(), height: $(window).height()};

  $(window).resize(function (evt) {
    $.each(winWh, function (type, val) {
      const curval = $(window)[type]();
      workarea[0]['scroll' + (type === 'width' ? 'Left' : 'Top')] -= (curval - val) / 2;
      winWh[type] = curval;
    });
  });

  workarea.scroll(() => {
    // TODO: jQuery's scrollLeft/Top() wouldn't require a null check
    if ($('#ruler_x').length) {
      $('#ruler_x')[0].scrollLeft = workarea[0].scrollLeft;
    }
    if ($('#ruler_y').length) {
      $('#ruler_y')[0].scrollTop = workarea[0].scrollTop;
    }
  });

  $('#url_notice').click(() => {
    /* await */ $.alert(this.title);
  });

  $('#change_image_url').click(promptImgURL);

  /**
  * @param {external:jQuery} elem
  * @todo Go back to the color boxes having white background-color and then setting
  *  background-image to none.png (otherwise partially transparent gradients look weird)
  * @returns {void}
  */
  const colorPicker = function (elem) {
    const picker = elem.attr('id') === 'stroke_color' ? 'stroke' : 'fill';
    // const opacity = (picker == 'stroke' ? $('#stroke_opacity') : $('#fill_opacity'));
    const title = picker === 'stroke'
      ? uiStrings.ui.pick_stroke_paint_opacity
      : uiStrings.ui.pick_fill_paint_opacity;
    // let wasNone = false; // Currently unused
    const pos = elem.offset();
    let {paint} = paintBox[picker];
    $('#color_picker')
      .draggable({
        cancel: '.jGraduate_tabs, .jGraduate_colPick, .jGraduate_gradPick, .jPicker',
        containment: 'window'
      })
      .css(configObj.curConfig.colorPickerCSS || {left: pos.left - 140, bottom: 40})
      .jGraduate(
        {
          images: {clientPath: './jgraduate/images/'},
          paint,
          window: {pickerTitle: title},
          // images: {clientPath: configObj.curConfig.imgPath},
          newstop: 'inverse'
        },
        function (p) {
          paint = new $.jGraduate.Paint(p);
          paintBox[picker].setPaint(paint);
          svgCanvas.setPaint(picker, paint);
          $('#color_picker').hide();
        },
        () => {
          $('#color_picker').hide();
        }
      );
  };

  /**
   * Paint box class.
   */
  class PaintBox {
    /**
     * @param {string|Element|external:jQuery} container
     * @param {"fill"} type
     */
    constructor (container, type) {
      const cur = configObj.curConfig[type === 'fill' ? 'initFill' : 'initStroke'];
      // set up gradients to be used for the buttons
      const svgdocbox = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16.5" height="16.5">
          <rect
            fill="#${cur.color}" opacity="${cur.opacity}"/>
          <defs><linearGradient id="gradbox_${PaintBox.ctr++}"/></defs>
        </svg>`,
        'text/xml'
      );

      let docElem = svgdocbox.documentElement;
      docElem = $(container)[0].appendChild(document.importNode(docElem, true));
      docElem.setAttribute('width', 16.5);

      this.rect = docElem.firstElementChild;
      this.defs = docElem.getElementsByTagName('defs')[0];
      this.grad = this.defs.firstElementChild;
      this.paint = new $.jGraduate.Paint({solidColor: cur.color});
      this.type = type;
    }

    /**
     * @param {module:jGraduate~Paint} paint
     * @param {boolean} apply
     * @returns {void}
     */
    setPaint (paint, apply) {
      this.paint = paint;

      const ptype = paint.type;
      const opac = paint.alpha / 100;

      let fillAttr = 'none';
      switch (ptype) {
      case 'solidColor':
        fillAttr = (paint[ptype] !== 'none') ? '#' + paint[ptype] : paint[ptype];
        break;
      case 'linearGradient':
      case 'radialGradient': {
        this.grad.remove();
        this.grad = this.defs.appendChild(paint[ptype]);
        const id = this.grad.id = 'gradbox_' + this.type;
        fillAttr = 'url(#' + id + ')';
        break;
      }
      }

      this.rect.setAttribute('fill', fillAttr);
      this.rect.setAttribute('opacity', opac);

      if (apply) {
        svgCanvas.setColor(this.type, this._paintColor, true);
        svgCanvas.setPaintOpacity(this.type, this._paintOpacity, true);
      }
    }

    /**
     * @param {boolean} apply
     * @returns {void}
     */
    update (apply) {
      if (!selectedElement) { return; }

      const {type} = this;
      switch (selectedElement.tagName) {
      case 'use':
      case 'image':
      case 'foreignObject':
        // These elements don't have fill or stroke, so don't change
        // the current value
        return;
      case 'g':
      case 'a': {
        const childs = selectedElement.getElementsByTagName('*');

        let gPaint = null;
        for (let i = 0, len = childs.length; i < len; i++) {
          const elem = childs[i];
          const p = elem.getAttribute(type);
          if (i === 0) {
            gPaint = p;
          } else if (gPaint !== p) {
            gPaint = null;
            break;
          }
        }

        if (gPaint === null) {
          // No common color, don't update anything
          this._paintColor = null;
          return;
        }
        this._paintColor = gPaint;
        this._paintOpacity = 1;
        break;
      } default: {
        this._paintOpacity = Number.parseFloat(selectedElement.getAttribute(type + '-opacity'));
        if (Number.isNaN(this._paintOpacity)) {
          this._paintOpacity = 1.0;
        }

        const defColor = type === 'fill' ? 'black' : 'none';
        this._paintColor = selectedElement.getAttribute(type) || defColor;
      }
      }

      if (apply) {
        svgCanvas.setColor(type, this._paintColor, true);
        svgCanvas.setPaintOpacity(type, this._paintOpacity, true);
      }

      this._paintOpacity *= 100;

      const paint = getPaint(this._paintColor, this._paintOpacity, type);
      // update the rect inside #fill_color/#stroke_color
      this.setPaint(paint);
    }

    /**
     * @returns {void}
     */
    prep () {
      const ptype = this.paint.type;

      switch (ptype) {
      case 'linearGradient':
      case 'radialGradient': {
        const paint = new $.jGraduate.Paint({copy: this.paint});
        svgCanvas.setPaint(this.type, paint);
        break;
      }
      }
    }
  }
  PaintBox.ctr = 0;

  paintBox.fill = new PaintBox('#fill_color', 'fill');
  paintBox.stroke = new PaintBox('#stroke_color', 'stroke');

  $('#stroke_width').val(configObj.curConfig.initStroke.width);
  $('#group_opacity').val(configObj.curConfig.initOpacity * 100);

  // Use this SVG elem to test vectorEffect support
  const testEl = paintBox.fill.rect.cloneNode(false);
  testEl.setAttribute('style', 'vector-effect:non-scaling-stroke');
  const supportsNonSS = (testEl.style.vectorEffect === 'non-scaling-stroke');
  testEl.removeAttribute('style');
  const svgdocbox = paintBox.fill.rect.ownerDocument;
  // Use this to test support for blur element. Seems to work to test support in Webkit
  const blurTest = svgdocbox.createElementNS(NS.SVG, 'feGaussianBlur');
  if (blurTest.stdDeviationX === undefined) {
    $('#blur').hide();
  }
  $(blurTest).remove();

  // Test for zoom icon support
  (function () {
    const pre = '-' + uaPrefix.toLowerCase() + '-zoom-';
    const zoom = pre + 'in';
    workarea.css('cursor', zoom);
    if (workarea.css('cursor') === zoom) {
      zoomInIcon = zoom;
      zoomOutIcon = pre + 'out';
    }
    workarea.css('cursor', 'auto');
  }());

  // Test for embedImage support (use timeout to not interfere with page load)
  setTimeout(() => {
    svgCanvas.embedImage('images/logo.svg', function (datauri) {
      if (!datauri) {
        // Disable option
        const $imgDialog = document.getElementById('se-img-prop');
        editor.pref('img_save', 'ref');
        $imgDialog.setAttribute('save', 'ref');
        $imgDialog.setAttribute('embed', 'one|' + uiStrings.notification.featNotSupported);
      }
    });
  }, 1000);

  $('#fill_color, #tool_fill').click(() => {
    colorPicker($('#fill_color'));
    updateToolButtonState();
  });

  $('#stroke_color, #tool_stroke').click(() => {
    colorPicker($('#stroke_color'));
    updateToolButtonState();
  });

  $('#group_opacityLabel').click(() => {
    $('#opacity_dropdown button').mousedown();
    $(window).mouseup();
  });

  $('.push_button').mousedown(() => {
    if (!$(this).hasClass('disabled')) {
      $(this).addClass('push_button_pressed').removeClass('push_button');
    }
  }).mouseout(() => {
    $(this).removeClass('push_button_pressed').addClass('push_button');
  }).mouseup(() => {
    $(this).removeClass('push_button_pressed').addClass('push_button');
  });

  const SIDEPANEL_MAXWIDTH = 300;
  const SIDEPANEL_OPENWIDTH = 150;
  let sidedrag = -1, sidedragging = false, allowmove = false;

  /**
   * @param {Float} delta
   * @fires module:svgcanvas.SvgCanvas#event:ext_workareaResized
   * @returns {void}
   */
  const changeSidePanelWidth = function (delta) {
    const rulerX = $('#ruler_x');
    $('#sidepanels').width('+=' + delta);
    $('#layerpanel').width('+=' + delta);
    rulerX.css('right', Number.parseInt(rulerX.css('right')) + delta);
    workarea.css('right', Number.parseInt(workarea.css('right')) + delta);
    svgCanvas.runExtensions('workareaResized');
  };

  /**
  * @param {Event} evt
  * @returns {void}
  */
  const resizeSidePanel = function (evt) {
    if (!allowmove) { return; }
    if (sidedrag === -1) { return; }
    sidedragging = true;
    let deltaX = sidedrag - evt.pageX;
    const sideWidth = $('#sidepanels').width();
    if (sideWidth + deltaX > SIDEPANEL_MAXWIDTH) {
      deltaX = SIDEPANEL_MAXWIDTH - sideWidth;
      // sideWidth = SIDEPANEL_MAXWIDTH;
    } else if (sideWidth + deltaX < 2) {
      deltaX = 2 - sideWidth;
      // sideWidth = 2;
    }
    if (deltaX === 0) { return; }
    sidedrag -= deltaX;
    changeSidePanelWidth(deltaX);
  };

  /**
   * If width is non-zero, then fully close it; otherwise fully open it.
   * @param {boolean} close Forces the side panel closed
   * @returns {void}
   */
  const toggleSidePanel = function (close) {
    const dpr = window.devicePixelRatio || 1;
    const w = $('#sidepanels').width();
    const isOpened = (dpr < 1 ? w : w / dpr) > 2;
    const zoomAdjustedSidepanelWidth = (dpr < 1 ? 1 : dpr) * SIDEPANEL_OPENWIDTH;
    const deltaX = (isOpened || close ? 0 : zoomAdjustedSidepanelWidth) - w;
    changeSidePanelWidth(deltaX);
  };

  $('#sidepanel_handle')
    .mousedown(function (evt) {
      sidedrag = evt.pageX;
      $(window).mousemove(resizeSidePanel);
      allowmove = false;
      // Silly hack for Chrome, which always runs mousemove right after mousedown
      setTimeout(() => {
        allowmove = true;
      }, 20);
    })
    .mouseup(function (evt) {
      if (!sidedragging) { toggleSidePanel(); }
      sidedrag = -1;
      sidedragging = false;
    });

  $(window).mouseup(() => {
    sidedrag = -1;
    sidedragging = false;
    $('#svg_editor').unbind('mousemove', resizeSidePanel);
  });

  layersPanel.populateLayers();

  const centerCanvas = () => {
    // this centers the canvas vertically in the workarea (horizontal handled in CSS)
    workarea.css('line-height', workarea.height() + 'px');
  };

  $(window).bind('load resize', centerCanvas);

  // function setResolution (w, h, center) {
  //   updateCanvas();
  //   // w -= 0; h -= 0;
  //   // $('#svgcanvas').css({width: w, height: h});
  //   // $('#canvas_width').val(w);
  //   // $('#canvas_height').val(h);
  //   //
  //   // if (center) {
  //   //   const wArea = workarea;
  //   //   const scrollY = h/2 - wArea.height()/2;
  //   //   const scrollX = w/2 - wArea.width()/2;
  //   //   wArea[0].scrollTop = scrollY;
  //   //   wArea[0].scrollLeft = scrollX;
  //   // }
  // }

  // Prevent browser from erroneously repopulating fields
  $('input,select').attr('autocomplete', 'off');

  /* eslint-disable jsdoc/require-property */
  /**
   * Associate all button actions as well as non-button keyboard shortcuts.
   * @namespace {PlainObject} module:SVGEditor~Actions
   */
  const Actions = (function () {
    /* eslint-enable jsdoc/require-property */
    /**
    * @typedef {PlainObject} module:SVGEditor.ToolButton
    * @property {string} sel The CSS selector for the tool
    * @property {external:jQuery.Function} fn A handler to be attached to the `evt`
    * @property {string} evt The event for which the `fn` listener will be added
    * @property {module:SVGEditor.Key} [key] [key, preventDefault, NoDisableInInput]
    * @property {string} [parent] Selector
    * @property {boolean} [hidekey] Whether to show key value in title
    * @property {string} [icon] The button ID
    */
    /**
     *
     * @name module:SVGEditor~ToolButtons
     * @type {module:SVGEditor.ToolButton[]}
     */
    // register action to top panel buttons
    $id('tool_source').addEventListener('click', showSourceEditor);
    $id('tool_wireframe').addEventListener('click', clickWireframe);
    $id('tool_undo').addEventListener('click', clickUndo);
    $id('tool_redo').addEventListener('click', clickRedo);
    $id('tool_clone').addEventListener('click', clickClone);
    $id('tool_clone_multi').addEventListener('click', clickClone);
    $id('tool_delete').addEventListener('click', deleteSelected);
    $id('tool_delete_multi').addEventListener('click', deleteSelected);
    $id('tool_move_top').addEventListener('click', moveToTopSelected);
    $id('tool_move_bottom').addEventListener('click', moveToBottomSelected);
    $id('tool_topath').addEventListener('click', convertToPath);
    $id('tool_make_link').addEventListener('click', makeHyperlink);
    $id('tool_make_link_multi').addEventListener('click', makeHyperlink);
    $id('tool_reorient').addEventListener('click', reorientPath);
    $id('tool_group_elements').addEventListener('click', clickGroup);
    $id('tool_align_left').addEventListener('click', () => clickAlign('left'));
    $id('tool_align_right').addEventListener('click', () => clickAlign('right'));
    $id('tool_align_center').addEventListener('click', () => clickAlign('center'));
    $id('tool_align_top').addEventListener('click', () => clickAlign('top'));
    $id('tool_align_bottom').addEventListener('click', () => clickAlign('bottom'));
    $id('tool_align_middle').addEventListener('click', () => clickAlign('middle'));
    $id('tool_node_clone').addEventListener('click', clonePathNode);
    $id('tool_node_delete').addEventListener('click', deletePathNode);
    $id('tool_openclose_path').addEventListener('click', opencloseSubPath);
    $id('tool_add_subpath').addEventListener('click', addSubPath);
    $id('tool_node_link').addEventListener('click', linkControlPoints);

    // register actions for left panel
    $id('tool_select').addEventListener('click', clickSelect);
    $id('tool_fhpath').addEventListener('click', clickFHPath);
    $id('tool_text').addEventListener('click', clickText);
    $id('tool_image').addEventListener('click', clickImage);
    $id('tool_zoom').addEventListener('click', clickZoom);
    $id('tool_zoom').addEventListener('dblclick', dblclickZoom);
    $id('tool_path').addEventListener('click', clickPath);
    $id('tool_line').addEventListener('click', clickLine);

    // flyout
    $id('tool_rect').addEventListener('click', clickRect);
    $id('tool_square').addEventListener('click', clickSquare);
    $id('tool_fhrect').addEventListener('click', clickFHRect);
    $id('tool_ellipse').addEventListener('click', clickEllipse);
    $id('tool_circle').addEventListener('click', clickCircle);
    $id('tool_fhellipse').addEventListener('click', clickFHEllipse);

    // register actions for bottom panel
    $id('zoom').addEventListener('change', (e) => changeZoom(e.detail.value));
    $id('elem_id').addEventListener('change', (e) => attrChanger(e));
    $id('elem_class').addEventListener('change', (e) => attrChanger(e));
    $id('circle_cx').addEventListener('change', (e) => attrChanger(e));
    $id('circle_cy').addEventListener('change', (e) => attrChanger(e));
    $id('circle_r').addEventListener('change', (e) => attrChanger(e));
    $id('ellipse_cx').addEventListener('change', (e) => attrChanger(e));
    $id('ellipse_cy').addEventListener('change', (e) => attrChanger(e));
    $id('ellipse_rx').addEventListener('change', (e) => attrChanger(e));
    $id('ellipse_ry').addEventListener('change', (e) => attrChanger(e));
    $id('selected_x').addEventListener('change', (e) => attrChanger(e));
    $id('selected_y').addEventListener('change', (e) => attrChanger(e));
    $id('rect_width').addEventListener('change', (e) => attrChanger(e));
    $id('rect_height').addEventListener('change', (e) => attrChanger(e));
    $id('line_x1').addEventListener('change', (e) => attrChanger(e));
    $id('line_y1').addEventListener('change', (e) => attrChanger(e));
    $id('line_x2').addEventListener('change', (e) => attrChanger(e));
    $id('line_y2').addEventListener('change', (e) => attrChanger(e));
    $id('image_width').addEventListener('change', (e) => attrChanger(e));
    $id('image_height').addEventListener('change', (e) => attrChanger(e));
    $id('path_node_x').addEventListener('change', (e) => attrChanger(e));
    $id('path_node_y').addEventListener('change', (e) => attrChanger(e));
    $id('angle').addEventListener('change', (e) => changeRotationAngle(e));
    $id('blur').addEventListener('change', (e) => changeBlur(e));
    $id('stroke_width').addEventListener('change', (e) => changeStrokeWidth(e));
    $id('rect_rx').addEventListener('change', (e) => changeRectRadius(e));
    $id('font_size').addEventListener('change', (e) => changeFontSize(e));

    // register actions in top toolbar
    $id('tool_source_save').addEventListener('click', saveSourceEditor);
    $id('tool_ungroup').addEventListener('click', clickGroup);
    $id('tool_unlink_use').addEventListener('click', clickGroup);
    $id('sidepanel_handle').addEventListener('click', toggleSidePanel);
    $id('copy_save_done').addEventListener('click', cancelOverlays);

    $id('tool_bold').addEventListener('click', clickBold);
    $id('tool_italic').addEventListener('click', clickItalic);
    $id('palette').addEventListener('change', handlePalette);

    $id('tool_clear').addEventListener('click', clickClear);
    $id('tool_open').addEventListener('click', function (e) {
      clickOpen();
      window.dispatchEvent(new CustomEvent('openImage'));
    });
    $id('tool_import').addEventListener('click', function (e) {
      clickImport();
      window.dispatchEvent(new CustomEvent('importImage'));
    });
    $id('tool_save').addEventListener('click', function (e) {
      if (editingsource) {
        saveSourceEditor();
      } else {
        clickSave();
      }
    });
    $id('tool_export').addEventListener('click', clickExport);
    $id('tool_docprops').addEventListener('click', showDocProperties);
    $id('tool_editor_prefs').addEventListener('click', showPreferences);
    $id('tool_editor_homepage').addEventListener('click', openHomePage);
    $id('se-img-prop').addEventListener('change', function (e) {
      if (e.detail.dialog === 'closed') {
        hideDocProperties();
      } else {
        saveDocProperties(e);
      }
    });
    $id('se-edit-prefs').addEventListener('change', function (e) {
      if (e.detail.dialog === 'closed') {
        hidePreferences();
      } else {
        savePreferences(e);
      }
    });
    layersPanel.addEvents();
    const toolButtons = [
      // Shortcuts not associated with buttons
      {key: 'ctrl+left', fn () { rotateSelected(0, 1); }},
      {key: 'ctrl+right', fn () { rotateSelected(1, 1); }},
      {key: 'ctrl+shift+left', fn () { rotateSelected(0, 5); }},
      {key: 'ctrl+shift+right', fn () { rotateSelected(1, 5); }},
      {key: 'shift+O', fn: selectPrev},
      {key: 'shift+P', fn: selectNext},
      {key: [modKey + 'up', true], fn () { zoomImage(2); }},
      {key: [modKey + 'down', true], fn () { zoomImage(0.5); }},
      {key: [modKey + ']', true], fn () { moveUpDownSelected('Up'); }},
      {key: [modKey + '[', true], fn () { moveUpDownSelected('Down'); }},
      {key: ['up', true], fn () { moveSelected(0, -1); }},
      {key: ['down', true], fn () { moveSelected(0, 1); }},
      {key: ['left', true], fn () { moveSelected(-1, 0); }},
      {key: ['right', true], fn () { moveSelected(1, 0); }},
      {key: 'shift+up', fn () { moveSelected(0, -10); }},
      {key: 'shift+down', fn () { moveSelected(0, 10); }},
      {key: 'shift+left', fn () { moveSelected(-10, 0); }},
      {key: 'shift+right', fn () { moveSelected(10, 0); }},
      {key: ['alt+up', true], fn () { svgCanvas.cloneSelectedElements(0, -1); }},
      {key: ['alt+down', true], fn () { svgCanvas.cloneSelectedElements(0, 1); }},
      {key: ['alt+left', true], fn () { svgCanvas.cloneSelectedElements(-1, 0); }},
      {key: ['alt+right', true], fn () { svgCanvas.cloneSelectedElements(1, 0); }},
      {key: ['alt+shift+up', true], fn () { svgCanvas.cloneSelectedElements(0, -10); }},
      {key: ['alt+shift+down', true], fn () { svgCanvas.cloneSelectedElements(0, 10); }},
      {key: ['alt+shift+left', true], fn () { svgCanvas.cloneSelectedElements(-10, 0); }},
      {key: ['alt+shift+right', true], fn () { svgCanvas.cloneSelectedElements(10, 0); }},
      {key: 'a', fn () { svgCanvas.selectAllInCurrentLayer(); }},
      {key: modKey + 'a', fn () { svgCanvas.selectAllInCurrentLayer(); }},
      // Standard shortcuts
      {key: modKey + 'z', fn: clickUndo},
      {key: modKey + 'shift+z', fn: clickRedo},
      {key: modKey + 'y', fn: clickRedo},

      {key: modKey + 'x', fn: cutSelected},
      {key: modKey + 'c', fn: copySelected},
      {key: modKey + 'v', fn: pasteInCenter}
    ];

    // Tooltips not directly associated with a single function
    const keyAssocs = {
      '4/Shift+4': '#tools_rect',
      '5/Shift+5': '#tools_ellipse'
    };

    return {
      /** @lends module:SVGEditor~Actions */
      /**
       * @returns {void}
       */
      setAll () {
        const keyHandler = {}; // will contain the action for each pressed key

        toolButtons.forEach((opts) => {
          // Bind function to shortcut key
          if (opts.key) {
            // Set shortcut based on options
            let keyval = opts.key;
            let pd = false;
            if (Array.isArray(opts.key)) {
              keyval = opts.key[0];
              if (opts.key.length > 1) { pd = opts.key[1]; }
            }
            keyval = String(keyval);
            const {fn} = opts;
            keyval.split('/').forEach((key) => { keyHandler[key] = {fn, pd}; });
          }
          return true;
        });
        // register the keydown event
        document.addEventListener('keydown', (e) => {
          // only track keyboard shortcuts for the body containing the SVG-Editor
          if (e.target.nodeName !== 'BODY') return;
          // normalize key
          const key = `${(e.metaKey) ? 'meta+' : ''}${(e.ctrlKey) ? 'ctrl+' : ''}${e.key.toLowerCase()}`;
          // return if no shortcut defined for this key
          if (!keyHandler[key]) return;
          // launch associated handler and preventDefault if necessary
          keyHandler[key].fn();
          if (keyHandler[key].pd) {
            e.preventDefault();
          }
        });

        // Misc additional actions

        // Make 'return' keypress trigger the change event
        $('.attr_changer, #image_url').bind(
          'keydown',
          'return',
          function (evt) {
            $(this).change();
            evt.preventDefault();
          }
        );

        $(window).bind('keydown', 'tab', function (e) {
          if (uiContext === 'canvas') {
            e.preventDefault();
            selectNext();
          }
        }).bind('keydown', 'shift+tab', function (e) {
          if (uiContext === 'canvas') {
            e.preventDefault();
            selectPrev();
          }
        });
      },
      /**
       * @returns {void}
       */
      setTitles () {
        $.each(keyAssocs, function (keyval, sel) {
          const menu = ($(sel).parents('#main_menu').length);

          $(sel).each(function () {
            const t = (menu) ? $(this).text().split(' [')[0] : this.title.split(' [')[0];
            let keyStr = '';
            // Shift+Up
            $.each(keyval.split('/'), function (i, key) {
              const modBits = key.split('+');
              let mod = '';
              if (modBits.length > 1) {
                mod = modBits[0] + '+';
                key = modBits[1];
              }
              keyStr += (i ? '/' : '') + mod + (uiStrings['key_' + key] || key);
            });
            if (menu) {
              this.lastChild.textContent = t + ' [' + keyStr + ']';
            } else {
              this.title = t + ' [' + keyStr + ']';
            }
          });
        });
      },
      /**
       * @param {string} sel Selector to match
       * @returns {module:SVGEditor.ToolButton}
       */
      getButtonData (sel) {
        return Object.values(toolButtons).find((btn) => {
          return btn.sel === sel;
        });
      }
    };
  }());

  // Select given tool
  editor.ready(function () {
    const preTool = $id(`tool_${configObj.curConfig.initTool}`);
    const regTool = $id(configObj.curConfig.initTool);
    const selectTool = $id('tool_select');
    const $editDialog = $id('se-edit-prefs');

    if (preTool) {
      preTool.click();
    } else if (regTool) {
      regTool.click();
    } else {
      selectTool.click();
    }

    if (configObj.curConfig.wireframe) {
      $id('tool_wireframe').click();
    }

    if (configObj.curConfig.showlayers) {
      toggleSidePanel();
    }

    $('#rulers').toggle(Boolean(configObj.curConfig.showRulers));

    if (configObj.curConfig.showRulers) {
      $editDialog.setAttribute('showrulers', true);
    }

    if (configObj.curConfig.baseUnit) {
      $editDialog.setAttribute('baseunit', configObj.curConfig.baseUnit);
    }

    if (configObj.curConfig.gridSnapping) {
      $editDialog.setAttribute('gridsnappingon', true);
    }

    if (configObj.curConfig.snappingStep) {
      $editDialog.setAttribute('gridsnappingstep', configObj.curConfig.snappingStep);
    }

    if (configObj.curConfig.gridColor) {
      $editDialog.setAttribute('gridcolor', configObj.curConfig.gridColor);
    }
  });

  // zoom
  $id('zoom').value = (svgCanvas.getZoom() * 100).toFixed(1);

  $('#workarea').contextMenu(
    {
      menu: 'cmenu_canvas',
      inSpeed: 0
    },
    function (action, el, pos) {
      switch (action) {
      case 'delete':
        deleteSelected();
        break;
      case 'cut':
        cutSelected();
        break;
      case 'copy':
        copySelected();
        break;
      case 'paste':
        svgCanvas.pasteElements();
        break;
      case 'paste_in_place':
        svgCanvas.pasteElements('in_place');
        break;
      case 'group':
      case 'group_elements':
        svgCanvas.groupSelectedElements();
        break;
      case 'ungroup':
        svgCanvas.ungroupSelectedElement();
        break;
      case 'move_front':
        moveToTopSelected();
        break;
      case 'move_up':
        moveUpDownSelected('Up');
        break;
      case 'move_down':
        moveUpDownSelected('Down');
        break;
      case 'move_back':
        moveToBottomSelected();
        break;
      default:
        if (hasCustomHandler(action)) {
          getCustomHandler(action).call();
        }
        break;
      }
    }
  );

  $('.contextMenu li').mousedown(function (ev) {
    ev.preventDefault();
  });

  $('#cmenu_canvas li').disableContextMenu();
  canvMenu.enableContextMenuItems('#delete,#cut,#copy');
  /**
   * @returns {void}
   */
  function enableOrDisableClipboard () {
    let svgeditClipboard;
    try {
      svgeditClipboard = localStorage.getItem('svgedit_clipboard');
    } catch (err) {}
    canvMenu[(svgeditClipboard ? 'en' : 'dis') + 'ableContextMenuItems'](
      '#paste,#paste_in_place'
    );
  }
  enableOrDisableClipboard();

  window.addEventListener('storage', function (e) {
    if (e.key !== 'svgedit_clipboard') { return; }

    enableOrDisableClipboard();
  });

  window.addEventListener('beforeunload', function (e) {
    // Suppress warning if page is empty
    if (undoMgr.getUndoStackSize() === 0) {
      editor.showSaveWarning = false;
    }

    // showSaveWarning is set to 'false' when the page is saved.
    if (!configObj.curConfig.no_save_warning && editor.showSaveWarning) {
      // Browser already asks question about closing the page
      e.returnValue = uiStrings.notification.unsavedChanges; // Firefox needs this when beforeunload set by addEventListener (even though message is not used)
      return uiStrings.notification.unsavedChanges;
    }
    return true;
  });

  /**
  * Expose the `uiStrings`.
  * @function module:SVGEditor.canvas.getUIStrings
  * @returns {module:SVGEditor.uiStrings}
  */
  editor.canvas.getUIStrings = () => {
    return uiStrings;
  };

  /**
   * @function module:SVGEditor.openPrep
   * @returns {boolean|Promise<boolean>} Resolves to boolean indicating `true` if there were no changes
   *  and `false` after the user confirms.
   */
  editor.openPrep = () => {
    $('#main_menu').hide();
    if (undoMgr.getUndoStackSize() === 0) {
      return true;
    }
    return $.confirm(uiStrings.notification.QwantToOpen);
  };

  /**
   *
   * @param {Event} e
   * @returns {void}
   */
  function onDragEnter (e) {
    e.stopPropagation();
    e.preventDefault();
    // and indicator should be displayed here, such as "drop files here"
  }

  /**
   *
   * @param {Event} e
   * @returns {void}
   */
  function onDragOver (e) {
    e.stopPropagation();
    e.preventDefault();
  }

  /**
   *
   * @param {Event} e
   * @returns {void}
   */
  function onDragLeave (e) {
    e.stopPropagation();
    e.preventDefault();
    // hypothetical indicator should be removed here
  }
  // Use HTML5 File API: http://www.w3.org/TR/FileAPI/
  // if browser has HTML5 File API support, then we will show the open menu item
  // and provide a file input to click. When that change event fires, it will
  // get the text contents of the file and send it to the canvas
  if (window.FileReader) {
    /**
    * @param {Event} e
    * @returns {void}
    */
    const importImage = function (e) {
      $.process_cancel(uiStrings.notification.loadingImage);
      e.stopPropagation();
      e.preventDefault();
      $('#main_menu').hide();
      const file = (e.type === 'drop') ? e.dataTransfer.files[0] : this.files[0];
      if (!file) {
        $('#dialog_box').hide();
        return;
      }
      /* if (file.type === 'application/pdf') { // Todo: Handle PDF imports

      }
      else */
      if (!file.type.includes('image')) {
        return;
      }
      // Detected an image
      // svg handling
      let reader;
      if (file.type.includes('svg')) {
        reader = new FileReader();
        reader.onloadend = function (ev) {
          const newElement = svgCanvas.importSvgString(ev.target.result, true);
          svgCanvas.ungroupSelectedElement();
          svgCanvas.ungroupSelectedElement();
          svgCanvas.groupSelectedElements();
          svgCanvas.alignSelectedElements('m', 'page');
          svgCanvas.alignSelectedElements('c', 'page');
          // highlight imported element, otherwise we get strange empty selectbox
          svgCanvas.selectOnly([newElement]);
          $('#dialog_box').hide();
        };
        reader.readAsText(file);
      } else {
        // bitmap handling
        reader = new FileReader();
        reader.onloadend = function ({target: {result}}) {
          /**
          * Insert the new image until we know its dimensions.
          * @param {Float} width
          * @param {Float} height
          * @returns {void}
          */
          const insertNewImage = function (width, height) {
            const newImage = svgCanvas.addSVGElementFromJson({
              element: 'image',
              attr: {
                x: 0,
                y: 0,
                width,
                height,
                id: svgCanvas.getNextId(),
                style: 'pointer-events:inherit'
              }
            });
            svgCanvas.setHref(newImage, result);
            svgCanvas.selectOnly([newImage]);
            svgCanvas.alignSelectedElements('m', 'page');
            svgCanvas.alignSelectedElements('c', 'page');
            updateContextPanel();
            $('#dialog_box').hide();
          };
          // create dummy img so we know the default dimensions
          let imgWidth = 100;
          let imgHeight = 100;
          const img = new Image();
          img.style.opacity = 0;
          img.addEventListener('load', () => {
            imgWidth = img.offsetWidth || img.naturalWidth || img.width;
            imgHeight = img.offsetHeight || img.naturalHeight || img.height;
            insertNewImage(imgWidth, imgHeight);
          });
          img.src = result;
        };
        reader.readAsDataURL(file);
      }
    };

    workarea[0].addEventListener('dragenter', onDragEnter);
    workarea[0].addEventListener('dragover', onDragOver);
    workarea[0].addEventListener('dragleave', onDragLeave);
    workarea[0].addEventListener('drop', importImage);

    const open = $('<input type="file">').change(async function (e) {
      const ok = await editor.openPrep();
      if (!ok) { return; }
      svgCanvas.clear();
      if (this.files.length === 1) {
        $.process_cancel(uiStrings.notification.loadingImage);
        const reader = new FileReader();
        reader.onloadend = async function ({target}) {
          await loadSvgString(target.result);
          updateCanvas();
        };
        reader.readAsText(this.files[0]);
      }
    });
    $('#tool_open').show();
    $(window).on('openImage', () => open.click());

    const imgImport = $('<input type="file">').change(importImage);
    $('#tool_import').show();
    $(window).on('importImage', () => imgImport.click());
  }

  updateCanvas(true);

  /**
  * @function module:SVGEditor.setLang
  * @param {string} lang The language code
  * @param {module:locale.LocaleStrings} allStrings See {@tutorial LocaleDocs}
  * @fires module:svgcanvas.SvgCanvas#event:ext_langReady
  * @fires module:svgcanvas.SvgCanvas#event:ext_langChanged
  * @returns {void} A Promise which resolves to `undefined`
  */
  const setLang = editor.setLang = function (lang, allStrings) {
    editor.langChanged = true;
    editor.pref('lang', lang);
    const $editDialog = document.getElementById('se-edit-prefs');
    $editDialog.setAttribute('lang', lang);
    if (!allStrings) {
      return;
    }
    // Todo: Remove `allStrings.lang` property in locale in
    //   favor of just `lang`?
    document.documentElement.lang = allStrings.lang; // lang;
    // Todo: Add proper RTL Support!
    // Todo: Use RTL detection instead and take out of locales?
    // document.documentElement.dir = allStrings.dir;
    $.extend(uiStrings, allStrings);

    // const notif = allStrings.notification; // Currently unused
    // $.extend will only replace the given strings
    const oldLayerName = $('#layerlist tr.layersel td.layername').text();
    const renameLayer = (oldLayerName === uiStrings.common.layer + ' 1');

    svgCanvas.setUiStrings(allStrings);
    Actions.setTitles();

    if (renameLayer) {
      svgCanvas.renameCurrentLayer(uiStrings.common.layer + ' 1');
      layersPanel.populateLayers();
    }

    svgCanvas.runExtensions('langChanged', /** @type {module:svgcanvas.SvgCanvas#event:ext_langChanged} */ lang);

    // Copy title for certain tool elements
    const elems = {
      '#stroke_color': '#tool_stroke .icon_label, #tool_stroke .color_block',
      '#fill_color': '#tool_fill label, #tool_fill .color_block',
      '#linejoin_miter': '#cur_linejoin',
      '#linecap_butt': '#cur_linecap'
    };

    $.each(elems, function (source, dest) {
      $(dest).attr('title', $(source)[0].title);
    });

    // Copy alignment titles
    $('#multiselected_panel div[id^=tool_align]').each(() => {
      $('#tool_pos' + this.id.substr(10))[0].title = this.title;
    });
  };

  // Load extensions
  extAndLocaleFunc();
};

/**
* @callback module:SVGEditor.ReadyCallback
* @returns {Promise<void>|void}
*/
/**
* Queues a callback to be invoked when the editor is ready (or
*   to be invoked immediately if it is already ready--i.e.,
*   if `runCallbacks` has been run).
* @function module:SVGEditor.ready
* @param {module:SVGEditor.ReadyCallback} cb Callback to be queued to invoke
* @returns {Promise<ArbitraryCallbackResult>} Resolves when all callbacks, including the supplied have resolved
*/
editor.ready = function (cb) { // eslint-disable-line promise/prefer-await-to-callbacks
  return new Promise((resolve, reject) => { // eslint-disable-line promise/avoid-new
    if (isReady) {
      resolve(cb()); // eslint-disable-line node/callback-return, promise/prefer-await-to-callbacks
      return;
    }
    callbacks.push([cb, resolve, reject]);
  });
};

/**
* Invokes the callbacks previous set by `svgEditor.ready`
* @function module:SVGEditor.runCallbacks
* @returns {Promise<void>} Resolves to `undefined` if all callbacks succeeded and rejects otherwise
*/
editor.runCallbacks = async () => {
  try {
    await Promise.all(callbacks.map(([cb]) => {
      return cb(); // eslint-disable-line promise/prefer-await-to-callbacks
    }));
  } catch (err) {
    callbacks.forEach(([, , reject]) => {
      reject();
    });
    throw err;
  }
  callbacks.forEach(([, resolve]) => {
    resolve();
  });
  isReady = true;
};

/**
 * @function module:SVGEditor.loadFromString
 * @param {string} str The SVG string to load
 * @param {PlainObject} [opts={}]
 * @param {boolean} [opts.noAlert=false] Option to avoid alert to user and instead get rejected promise
 * @returns {Promise<void>}
 */
editor.loadFromString = function (str, {noAlert} = {}) {
  return editor.ready(async () => {
    try {
      await loadSvgString(str, {noAlert});
    } catch (err) {
      if (noAlert) {
        throw err;
      }
    }
  });
};

/**
 * @callback module:SVGEditor.URLLoadCallback
 * @param {boolean} success
 * @returns {void}
 */
/**
 * @function module:SVGEditor.loadFromURL
 * @param {string} url URL from which to load an SVG string via Ajax
 * @param {PlainObject} [opts={}] May contain properties: `cache`, `callback`
 * @param {boolean} [opts.cache]
 * @param {boolean} [opts.noAlert]
 * @returns {Promise<void>} Resolves to `undefined` or rejects upon bad loading of
 *   the SVG (or upon failure to parse the loaded string) when `noAlert` is
 *   enabled
 */
editor.loadFromURL = function (url, {cache, noAlert} = {}) {
  return editor.ready(() => {
    return new Promise((resolve, reject) => { // eslint-disable-line promise/avoid-new
      $.ajax({
        url,
        dataType: 'text',
        cache: Boolean(cache),
        beforeSend () {
          $.process_cancel(uiStrings.notification.loadingImage);
        },
        success (str) {
          loadSvgString(str, {noAlert});
        },
        error (xhr, stat, err) {
          if (xhr.status !== 404 && xhr.responseText) {
            loadSvgString(xhr.responseText, {noAlert});
            return;
          }
          if (noAlert) {
            reject(new Error('URLLoadFail'));
            return;
          }
          $.alert(uiStrings.notification.URLLoadFail + ': \n' + err);
          resolve();
        },
        complete () {
          $('#dialog_box').hide();
        }
      });
    });
  });
};

/**
* @function module:SVGEditor.loadFromDataURI
* @param {string} str The Data URI to base64-decode (if relevant) and load
* @param {PlainObject} [opts={}]
* @param {boolean} [opts.noAlert]
* @returns {Promise<void>} Resolves to `undefined` and rejects if loading SVG string fails and `noAlert` is enabled
*/
editor.loadFromDataURI = function (str, {noAlert} = {}) {
  return editor.ready(() => {
    let base64 = false;
    let pre = str.match(/^data:image\/svg\+xml;base64,/);
    if (pre) {
      base64 = true;
    } else {
      pre = str.match(/^data:image\/svg\+xml(?:;|;utf8)?,/);
    }
    if (pre) {
      pre = pre[0];
    }
    const src = str.slice(pre.length);
    return loadSvgString(base64 ? Utils.decode64(src) : decodeURIComponent(src), {noAlert});
  });
};

/**
 * @function module:SVGEditor.addExtension
 * @param {string} name Used internally; no need for i18n.
 * @param {module:svgcanvas.ExtensionInitCallback} init Config to be invoked on this module
 * @param {module:svgcanvas.ExtensionInitArgs} initArgs
 * @throws {Error} If called too early
 * @returns {Promise<void>} Resolves to `undefined`
*/
editor.addExtension = (name, init, initArgs) => {
  // Note that we don't want this on editor.ready since some extensions
  // may want to run before then (like server_opensave).
  if (!svgCanvas) {
    throw new Error('Extension added too early');
  }
  return svgCanvas.addExtension.call(editor, name, init, initArgs);
};

// Defer injection to wait out initial menu processing. This probably goes
//    away once all context menu behavior is brought to context menu.
editor.ready(() => {
  injectExtendedContextMenuItemsIntoDom();
});

let extensionsAdded = false;
const messageQueue = [];
/**
 * @param {PlainObject} info
 * @param {any} info.data
 * @param {string} info.origin
 * @fires module:svgcanvas.SvgCanvas#event:message
 * @returns {void}
 */
const messageListener = ({data, origin}) => { // eslint-disable-line no-shadow
  // console.log('data, origin, extensionsAdded', data, origin, extensionsAdded);
  const messageObj = {data, origin};
  if (!extensionsAdded) {
    messageQueue.push(messageObj);
  } else {
    // Extensions can handle messages at this stage with their own
    //  canvas `message` listeners
    svgCanvas.call('message', messageObj);
  }
};
window.addEventListener('message', messageListener);

// Run init once DOM is loaded
// jQuery(editor.init);

(async () => {
try {
  // We wait a micro-task to let the svgEditor variable be defined for module checks
  await Promise.resolve();
  editor.init();
} catch (err) {
  console.error(err); // eslint-disable-line no-console
}
})();

export default editor;
