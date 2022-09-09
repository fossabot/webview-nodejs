import { Library, Callback, LIB_EXT, ForeignFunction } from 'ffi-napi';
import {Pointer} from 'ref-napi';
import path from 'path';
import fs from 'fs';

type webview_t = Pointer<unknown>;
type pointer = Pointer<unknown>;
type BindCallback = Pointer<(...args: ("string" | "pointer")[]) => void>
type WebviewFFI = {
    webview_create    : ForeignFunction<webview_t, [number, pointer]>,
    webview_run       : ForeignFunction<void, [webview_t]>,
    webview_terminate : ForeignFunction<void, [webview_t]>,
    webview_destroy   : ForeignFunction<void, [webview_t]>,
    webview_set_title : ForeignFunction<void, [webview_t, string]>,
    webview_set_html  : ForeignFunction<void, [webview_t, string]>,
    webview_navigate  : ForeignFunction<void, [webview_t, string]>,
    webview_init      : ForeignFunction<void, [webview_t, string]>,
    webview_eval      : ForeignFunction<void, [webview_t, string]>,
    webview_dispatch  : ForeignFunction<void, [webview_t, pointer]>,
    webview_bind      : ForeignFunction<void, [webview_t, string, BindCallback, pointer ]>,
    webview_return    : ForeignFunction<void, [webview_t, string, number, string ]>,
    webview_unbind    : ForeignFunction<void, [webview_t, string]>,
    webview_set_size  : ForeignFunction<void, [webview_t, number,number,number]>,
}

/** 
 * get lib path from node_modules and extract webview2loader in windows
 * @return the path to libwebview
*/
export function getLibraryPath() :string {
    let dir = __dirname;
    let arch = process.arch;
    let platform = process.platform;
    let libName = 'libwebview' + LIB_EXT;
    if(platform == 'win32'){
        libName = libName.replace(/^(lib)/,'');
        // Copy dlls
        let dst = path.join('.','WebView2Loader.dll');
        if(!fs.existsSync(dst)) {
            fs.copyFileSync(path.join(dir,'libs',platform,arch,'WebView2Loader.dll'),dst);
        }
    }
    if(['linux','win32','darwin'].includes(platform) && arch == 'x64') {
        return path.join(dir,'libs',platform,arch,libName)
    }else{
        throw new ReferenceError("Unsupported pattform: " + platform + arch);
    }
}

export class Webview {
    lib :WebviewFFI
    webview :webview_t
    
    WindowHint = {
        /** Width and height are default size */
        NONE: 0,
        /** Width and height are minimum bounds */
        MIN: 1,
        /** Width and height are maximum bounds */
        MAX: 2,
        /** Window size can not be changed by a user */
        FIXED: 3,
    } as const;

    /**
     * Create a webview.
     *
     * @debug enable DevTools and other debug features.
     * @param libPath the path to lib(dll/so/dylib). If not set, it will use built in libs.
     */  
    constructor(debug=false, libPath = getLibraryPath()) {
        this.lib = new Library(libPath, { 
            'webview_create'   : [ 'pointer', [ 'int', 'pointer' ] ],
            'webview_run'      : [ 'void'   , [ 'pointer' ] ],
            'webview_terminate': [ 'void'   , [ 'pointer' ] ],
            'webview_destroy'  : [ 'void'   , [ 'pointer' ] ],
            'webview_set_title': [ 'void'   , [ 'pointer', 'string' ] ],
            'webview_set_html' : [ 'void'   , [ 'pointer', 'string' ] ],
            'webview_navigate' : [ 'void'   , [ 'pointer', 'string' ] ],
            'webview_init'     : [ 'void'   , [ 'pointer', 'string' ] ],
            'webview_eval'     : [ 'void'   , [ 'pointer', 'string' ] ],
            'webview_dispatch' : [ 'void'   , [ 'pointer', 'pointer'] ],
            'webview_bind'     : [ 'void'   , [ 'pointer', 'string', 'pointer', 'pointer' ] ],
            'webview_return'   : [ 'void'   , [ 'pointer', 'string', 'int', 'string' ] ],
            'webview_unbind'   : [ 'void'   , [ 'pointer', 'string' ] ],
            'webview_set_size' : [ 'void'   , [ 'pointer', 'int', 'int', 'int' ] ],
        });
        this.webview = this.lib.webview_create(debug ? 1 : 0, (null as unknown as pointer));
        console.assert(this.webview != null);

    }

    /**
     * Updates the title of the native window.
     *
     * Must be called from the UI thread.
     *
     * @param v the new title
     */ 
    title(v: string) {
        this.lib.webview_set_title(this.webview,v)
    }

    /**
     * Navigates webview to the given URL
     *
     * URL may be a data URI, i.e. "data:text/text,...". It is often ok not to url-encode it properly, webview will re-encode it for you. Same as [navigate]
     *
     * @param v the URL or URI
     * */
    navigate(url: string) {
        this.lib.webview_navigate(this.webview,url)
    }

    /**
     * Set webview HTML directly.
     *
     * @param v the HTML content
     */
    html(v: string) {
        this.lib.webview_set_html(this.webview,v)
    }

    /**
    * Updates the size of the native window.
    *
    * Accepts a WEBVIEW_HINT
    *
    * @param hints can be one of `NONE(=0)`, `MIN(=1)`, `MAX(=2)` or `FIXED(=3)`
    */    
    size(width: number, height: number, hints: number) {
        this.lib.webview_set_size(this.webview,width,height,hints)
    }

    /**
    * Injects JS code at the initialization of the new page.
    *
    * Every time the webview will open a new page - this initialization code will be executed. It is guaranteed that code is executed before window.onload.
    *
    * @param js the JS code
    */
    init(js: string) {
        this.lib.webview_init(this.webview,js)
    }

    /**
     * Evaluates arbitrary JS code.
     *
     * Evaluation happens asynchronously, also the result of the expression is ignored. Use the `webview_bind` function if you want to receive notifications about the results of the evaluation.
     *
     * @param js the JS code
     */
    eval(js: string) {
        this.lib.webview_eval(this.webview,js)
    }

    /**
     * Binds a native Kotlin/Java callback so that it will appear under the given name as a global JS function.
     *
     * Callback receives a request string. Request string is a JSON array of all the arguments passed to the JS function.
     *
     * @param name the name of the global JS function
     * @param fn the callback function receives the request parameter in webview browser and return the response(=[isSuccess,result]), both in JSON string. If isSuccess=false, it wll reject the Promise.
     */
    bindRaw(name :string, fn :(w: Webview,req :string)=>[boolean,string]) {
        let callback = Callback('void',['string','string','pointer'], (seq,req,_arg) => {
            const [isSuccess,result] = fn(this,req)
            this.lib.webview_return(this.webview,seq,isSuccess?0:1,result);
        });
        this.lib.webview_bind(this.webview, name, callback, null as unknown as pointer );
        process.on('exit', function() { callback; });
    }

    /**
    * Binds a Kotlin callback so that it will appear under the given name as a global JS function.
    *
    * @param name the name of the global browser JS function
    * @param fn the callback function which receives the parameter and return the result to Webview. Any exception happened in Node.js here will reject the `Promise` instead of crash the program.
    * 
    * ### Example
    * 
    * ```js
    * bind("sumInNodeJS",(arg0,arg1) => {
    *   return arg0+arg1;
    * });
    * ```
    * in Webview browser, you should call `await sumInNodeJS(1,2)` and get `3`
    */
    bind(name: string,fn: (w: Webview, ...args :any[]) => any) {
        this.bindRaw(name, (w: any,req: string)=>{
            let args :any[] = JSON.parse(req);
            try {
                return [true,JSON.stringify(fn(w,...args))];
            } catch(error) {
                return [false, JSON.stringify(error)]
            }
        })
    }

    /**
    * Posts a function to be executed on the main thread.
    *
    * It safely schedules the callback to be run on the main thread on the next main loop iteration.
    *
    * @param fn the function to be executed on the main thread.
    */
    dispatch(fn: (arg0: this) => void) {
        let callback = Callback('void',['pointer','pointer'], (_,arg) => {
            fn(this);
        });
        this.lib.webview_dispatch(this.webview,callback);
        process.on('exit', function() { callback; });
    }

    /**
     * Removes a callback that was previously set by `webview_bind`.
     *
     * @param name the name of JS function used in `webview_bind`
     */    
    unbind(name: string) {
        this.lib.webview_unbind(this.webview,name)
    }

    /**
     * Runs the main loop and destroy it when terminated.
     *
     * This will block the thread.
     */
    show() {
        this.lib.webview_run(this.webview)
        this.lib.webview_destroy(this.webview)
    }

    /**
     * Stops the main loop.
     *
     * It is safe to call this function from another other background thread.
     */
    terminate() {
        this.lib.webview_terminate(this.webview)
    }
}

