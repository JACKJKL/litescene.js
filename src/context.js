/**
* Context class allows to handle the app context easily without having to glue manually all events
	There is a list of options
	==========================
	- canvas: the canvas where the scene should be rendered, if not specified one will be created
	- container_id: string with container id where to create the canvas, width and height will be those from the container
	- width: the width for the canvas in case it is created without a container_id
	- height: the height for the canvas in case it is created without a container_id
	- resources: string with the path to the resources folder
	- shaders: string with the url to the shaders.xml file
	- proxy: string with the url where the proxy is located (useful to avoid CORS)
	- filesystems: object that contains the virtual file systems info { "VFS":"http://litefileserver.com/" } ...
	- redraw: boolean to force to render the scene constantly (useful for animated scenes)
	- autoresize: boolean to automatically resize the canvas when the window is resized
	Optional callbacks to attach
	============================
	- onPreDraw: executed before drawing a frame
	- onDraw: executed after drawing a frame
	- onPreUpdate(dt): executed before updating the scene (delta_time as parameter)
	- onUpdate(dt): executed after updating the scene (delta_time as parameter)
	- onMouse(e): when a mouse event is triggered
	- onKey(e): when a key event is triggered
* @namespace LS
* @class Context
* @constructor
* @param {Object} options settings for the webgl context creation
*/
function Context(options)
{
	options = options || {};

	if(!options.canvas)
	{
		var container = options.container;
		if(options.container_id)
			container = document.getElementById(options.container_id);

		if(container)
		{
			//create canvas
			var canvas = document.createElement("canvas");
			canvas.width = container.offsetWidth;
			canvas.height = container.offsetHeight;
			if(!canvas.width) canvas.width = options.width || 1;
			if(!canvas.height) canvas.height = options.height || 1;
			container.appendChild(canvas);
			options.canvas = canvas;
		}
	}

	this.gl = GL.create(options);
	this.canvas = this.gl.canvas;
	this.render_options = new RenderOptions();
	this.scene = LS.GlobalScene;

	if(options.resources)
		LS.ResourcesManager.setPath( options.resources );
	if(options.shaders)
		LS.ShadersManager.init( options.shaders );
	if(options.proxy)
		LS.ResourcesManager.setProxy( options.proxy );
	if(options.filesystems)
	{
		for(var i in options.filesystems)
			LS.ResourcesManager.registerFileSystem( i, options.filesystems[i] );
	}

	if(options.autoresize)
	{
		window.addEventListener("resize", (function(){
			this.canvas.width = canvas.parentNode.offsetWidth;
			this.canvas.height = canvas.parentNode.offsetHeight;
		}).bind(this));
	}

	LS.Renderer.init();

	//this will repaint every frame and send events when the mouse clicks objects
	this.force_redraw = options.redraw || false;
	this.interactive = true;
	this.state = "playing";

	//bind all the events 
	if( this.gl.ondraw )
		throw("There is already a litegl attached to this context");

	this.gl.ondraw = Context.prototype._ondraw.bind(this);
	this.gl.onupdate = Context.prototype._onupdate.bind(this);
	this.gl.onmousedown = Context.prototype._onmouse.bind(this);
	this.gl.onmousemove = Context.prototype._onmouse.bind(this);
	this.gl.onmouseup = Context.prototype._onmouse.bind(this);
	this.gl.onmousewheel = Context.prototype._onmouse.bind(this);
	this.gl.onkeydown = Context.prototype._onkey.bind(this);
	this.gl.onkeyup = Context.prototype._onkey.bind(this);

	//capture input
	gl.captureMouse(true);
	gl.captureKeys(true);

	//launch render loop
	gl.animate();
}

/**
* Loads an scene and triggers start
* @method loadScene
* @param {String} url url to the JSON file containing all the scene info
* @param {Function} on_complete callback trigged when the scene and the resources are loaded
*/
Context.prototype.loadScene = function(url, on_complete)
{
	var scene = this.scene;
	scene.load(url, inner_start);

	function inner_start()
	{
		scene.start();
		if(on_complete)
			on_complete();
		console.log("Scene playing");
	}
}

/**
* loads Scene from object or JSON
* @method setScene
* @param {Object} scene
* @param {Function} on_complete callback trigged when the scene and the resources are loaded
*/
Context.prototype.setScene = function(scene_info, on_complete)
{
	var scene = this.scene;
	if(typeof(scene_info) == "string")
		scene_info = JSON.parse(scene_info);
	scene.configure( scene_info );
	scene.loadResources( inner_all_loaded );

	function inner_all_loaded()
	{
		scene.start();
		if(on_complete)
			on_complete();
		scene._must_redraw = true;
		console.log("Scene playing");
	}
}


Context.prototype.pause = function()
{
	this.state = "paused";
}

Context.prototype.play = function()
{
	this.state = "playing";
}

Context.prototype._ondraw = function()
{
	if(this.state != "playing")
		return;

	if(this.onPreDraw)
		this.onPreDraw();

	var scene = this.scene;

	if(scene._must_redraw || this.force_redraw )
	{
		scene.render( this.render_options );
	}

	if(this.onDraw)
		this.onDraw();
}

Context.prototype._onupdate = function(dt)
{
	if(this.state != "playing")
		return;

	if(this.onPreUpdate)
		this.onPreUpdate(dt);

	this.scene.update(dt);

	if(this.onUpdate)
		this.onUpdate(dt);
}

//input
Context.prototype._onmouse = function(e)
{
	//trace(e);
	if(this.state != "playing")
		return;

	//check which node was clicked
	if(this.interactive && (e.eventType == "mousedown" || e.eventType == "mousewheel" ))
	{
		var node = LS.Picking.getNodeAtCanvasPosition( this.scene, null, e.canvasx, e.canvasy );
		this._clicked_node = node;
	}

	var levent = null; //levent dispatched

	//send event to clicked node
	if(this._clicked_node && this._clicked_node.flags.interactive)
	{
		e.scene_node = this._clicked_node;
		levent = LEvent.trigger(this._clicked_node,e.eventType,e);
	}

	//send event to root
	if(!levent || !levent.stop)
		LEvent.trigger( this.scene.root,e.eventType,e);

	if(e.eventType == "mouseup")
		this._clicked_node = null;

	if(this.onMouse)
	{
		e.scene_node = this._clicked_node;
		var r = this.onMouse(e);
		if(r) return;
	}
}

Context.prototype._onkey = function(e)
{
	if(this.state != "playing")
		return;

	if(this.onKey)
	{
		var r = this.onKey(e);
		if(r) return;
	}

	LEvent.trigger( this.scene,e.eventType,e);
}

LS.Context = Context;
