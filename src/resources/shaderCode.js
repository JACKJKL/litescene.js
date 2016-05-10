
/**
* ShaderCode is a resource containing all the code associated to a shader
* It is used to define special ways to render scene objects, having full control of the rendering algorithm
* Having a special class helps to parse the data in advance and share it between different materials
* 
* @class ShaderCode
* @constructor
*/

function ShaderCode( code )
{
	this._code = null;

	this._init_function = null;
	this._global_uniforms = {};
	this._code_parts = {};
	this._subfiles = {};
	this._compiled_shaders = {};

	if(code)
		this.code = code;
}

Object.defineProperty( ShaderCode.prototype, "code", {
	enumerable: true,
	get: function() {
		return this._code;
	},
	set: function(v) {
		if(this._code == v)
			return;
		this._code = v;
		this.processCode();
	}
});

//parse the code
//store in a easy to use way
ShaderCode.prototype.processCode = function()
{
	var code = this._code;
	this._global_uniforms = {};
	this._code_parts = {};
	this._compiled_shaders = {};
	this._init_function = null;

	var subfiles = GL.processFileAtlas( this._code );
	this._subfiles = subfiles;

	var num_subfiles = 0;
	var init_code = null; 

	for(var i in subfiles)
	{
		var subfile_name = i;
		var subfile_data = subfiles[i];
		num_subfiles++;

		if(!subfile_name)
			continue;

		if(subfile_name == "js")
		{
			init_code = subfile_data;
			continue;
		}

		if(subfile_name == "uniforms")
		{
			var lines = subfile_data.split("/n");
			for(var j = 0; j < lines.length; ++j)
			{
				var line = lines[j].trim();
				var words = line.split(" ");
				var value = words[3];
				if( value !== undefined )
					value = LS.stringToValue(value);
				var options = null;
				var options_index = line.indexOf("{");
				if(options_index != -1)
					options = LS.stringToValue(line.substr(options_index));
				this._global_uniforms[ words[0] ] = { name: words[0], uniform: words[1], type: words[2], value: value, options: options };
			}
			continue;
		}

		var name = LS.ResourcesManager.removeExtension( subfile_name );
		var extension = LS.ResourcesManager.getExtension( subfile_name );

		if(extension == "vs" || extension == "fs")
		{
			var code_part = this._code_parts[name];
			if(!code_part)
				code_part = this._code_parts[name] = {};
			//parse data (extract pragmas and stuff)
			code_part[ extension ] = LS.ShaderCode.parseGLSLCode( subfile_data );
		}
	}

	//compile the shader before using it to ensure there is no errors
	this.getShader();

	//process init code
	if(init_code)
	{
		//clean code
		init_code = LS.ShaderCode.removeComments(init_code);

		if(init_code) //still some code? (we test it because if there is a single line of code the behaviour changes)
		{
			if(LS.catch_exceptions)
			{
				try
				{
					this._init_function = new Function( init_code );
				}
				catch (err)
				{
					LS.dispatchCodeError( err, LScript.computeLineFromError(err), this );
				}
			}
			else
				this._init_function = new Function( init_code );
		}
	}

	//to alert all the materials out there using this shader that they must update themselves.
	LEvent.trigger( LS.ShaderCode, "modified", this );
}

//used when storing/retrieving the resource
ShaderCode.prototype.setData = function(v, skip_modified_flag)
{
	this.code = v;
	if(!skip_modified_flag)
		this._modified = true;
}

ShaderCode.prototype.getData = function()
{
	return this._code;
}

ShaderCode.prototype.getDataToStore = function()
{
	return this._code;
}

//compile the shader, cache and return
ShaderCode.prototype.getShader = function( render_mode, flags )
{
	render_mode = render_mode || "default";
	flags = flags || 0;

	//search for a compiled version of the shader
	var shader = this._compiled_shaders[ render_mode ];
	if(shader)
		return shader;

	//search for the code
	var code = this._code_parts[ render_mode ];
	if(!code)
		return null;

	//vertex shader code
	var vs_code = null;
	if(render_mode == "fx")
		vs_code = GL.Shader.SCREEN_VERTEX_SHADER;
	else if( !code.vs )
		return null;
	else
		vs_code = this.getCodeFromSubfile( code.vs );

	//fragment shader code
	if( !code.fs )
		return;
	var fs_code = this.getCodeFromSubfile( code.fs );

	//no code or code includes something missing
	if(!vs_code || !fs_code) 
		return null;

	//compile the shader and return it
	var shader = this.compileShader( vs_code, fs_code );
	if(!shader)
		return null;

	this._compiled_shaders[ render_mode ] = shader;
	return shader;
}

ShaderCode.prototype.compileShader = function( vs_code, fs_code)
{
	if(!LS.catch_exceptions)
		return new GL.Shader( vs_code, fs_code );
	else
	{
		try
		{
			return new GL.Shader( vs_code, fs_code );
		}
		catch(err)
		{
			LS.ShadersManager.dumpShaderError( this.filename, err, vs_code, fs_code );
			LS.dispatchCodeError(err);
		}
	}
	return null;
}

ShaderCode.prototype.getCodeFromSubfile = function( subfile )
{
	if( !subfile.is_dynamic )
		return subfile.code;

	var code = "";
	var blocks = subfile.blocks;

	for(var i = 0; i < blocks.length; ++i)
	{
		var block = blocks[i];
		if( block.type == 1 ) //regular code
		{
			code += block.code;
			continue;
		}

		//pragma
		if(block.include)
		{
			var filename = block.include;
			var ext = LS.ResourcesManager.getExtension( filename );
			if(ext)
			{
				var extra_shadercode = LS.ResourcesManager.getResource( filename, LS.ShaderCode );
				if(!extra_shadercode)
				{
					LS.ResourcesManager.load( filename ); //force load
					return null;
				}
				if(!block.include_subfile)
					code += "\n" + extra_shadercode._subfiles[""] + "\n";
				else
				{
					var extra = extra_shadercode._subfiles[ block.include_subfile ];
					if(extra === undefined)
						return null;
					code += "\n" + extra + "\n";
				}
			}
			else
			{
				var snippet_code = LS.ShadersManager.getSnippet( filename );
				if( !snippet_code )
					return null; //snippet not found
				code += "\n" + snippet_code.code + "\n";
			}
		}
	}

	return code;
}

//given a code with some pragmas, it separates them
ShaderCode.parseGLSLCode = function( code )
{
	//remove comments
	code = code.replace(/(\/\*([\s\S]*?)\*\/)|(\/\/(.*)$)/gm, '');

	var blocks = [];
	var current_block = [];
	var pragmas = {};
	var uniforms = {};
	var includes = {};
	var is_dynamic = false; //means this shader has no variations using pragmas or macros

	var lines = code.split("\n");

	/* REMOVED: fors could have problems
	//clean (this helps in case a line contains two instructions, like "uniform float a; uniform float b;"
	var clean_lines = [];
	for(var i = 0; i < lines.length; i++)
	{
		var line = lines[i].trim();
		if(!line)
			continue;
		var pos = line.lastIndexOf(";");
		if(pos == -1 || pos == lines.length - 1)
			clean_lines.push(line);
		else
		{
			var sublines = line.split(";");
			for(var j = 0; j < sublines.length; ++j)
			{
				if(sublines[j])
					clean_lines.push( sublines[j] + ";" );
			}
		}
	}
	lines = clean_lines;
	*/

	//parse
	for(var i = 0; i < lines.length; i++)
	{
		var line = lines[i].trim();
		if(!line.length)
			continue;//empty line

		if(line[0] != "#")
		{
			var words = line.split(" ");
			if( words[0] == "uniform" ) //store which uniforms we found in the code (not used)
			{
				var uniform_name = words[2].split(";");
				uniforms[ uniform_name[0] ] = words[1];
			}
			current_block.push(line);
			continue;
		}

		var t = line.split(" ");
		if(t[0] == "#pragma")
		{
			is_dynamic = true;
			pragmas[ t[2] ] = true;
			var action = t[1];
			blocks.push( { type: 1, code: current_block.join("\n") } ); //merge lines and add as block
			current_block.length = 0;
			var pragma_info = { type: 2, line: line, action: action, param: t[2] };
			if( action == "include" && t[2] )
			{
				var include = t[2].substr(1, t[2].length - 2); //safer than JSON.parse
				var fullname = include.split(":");
				var filename = fullname[0];
				var subfile = fullname[1];
				pragma_info.include = filename;
				pragma_info.include_subfile = subfile;
				includes[ pragma_info.include ] = true;
			}
			blocks.push( pragma_info ); //add pragma block
		}
		else
			current_block.push( line ); //add line to current block lines
	}

	if(current_block.length)
		blocks.push( { type: 1, code: current_block.join("\n") } ); //merge lines and add as block

	return {
		is_dynamic: is_dynamic,
		code: code,
		blocks: blocks,
		pragmas: pragmas,
		uniforms: uniforms,
		includes: {}
	};
}

//makes this resource available 
ShaderCode.prototype.register = function()
{
	LS.ResourcesManager.registerResource( this.fullpath || this.filename, this );
}

//searches for materials using this ShaderCode and forces them to be updated (update the properties)
ShaderCode.prototype.applyToMaterials = function( scene )
{
	scene = scene || LS.GlobalScene;
	var filename = this.fullpath || this.filename;

	//materials in the resources
	for(var i in LS.ResourcesManager.resources)
	{
		var res = LS.ResourcesManager.resources[i];
		if( res.constructor !== LS.ShaderMaterial || res._shader != filename )
			continue;

		res.processShaderCode();
	}

	//embeded materials
	var nodes = LS.GlobalScene.getNodes();
	for(var i = 0; i < nodes.length; ++i)
	{
		var node = nodes[i];
		if(node.material && node.material.constructor === LS.ShaderMaterial && node.material._shader == filename )
			node.material.processShaderCode();
	}
}

ShaderCode.removeComments = function( code )
{
	// /^\s*[\r\n]/gm
	return code.replace(/(\/\*([\s\S]*?)\*\/)|(\/\/(.*)$)/gm, '');
}

//Example code for a shader
ShaderCode.examples = {};

ShaderCode.examples.fx = "\n\
\\fx.fs\n\
	precision highp float;\n\
	\n\
	uniform float u_time;\n\
	uniform vec4 u_viewport;\n\
	uniform sampler2D u_texture;\n\
	varying vec2 v_coord;\n\
	void main() {\n\
		gl_FragColor = texture2D( u_texture, v_coord );\n\
	}\n\
";

ShaderCode.examples.color = "\n\
\n\
\\default.vs\n\
\n\
precision mediump float;\n\
attribute vec3 a_vertex;\n\
attribute vec3 a_normal;\n\
attribute vec2 a_coord;\n\
\n\
//varyings\n\
varying vec3 v_pos;\n\
varying vec3 v_normal;\n\
varying vec2 v_uvs;\n\
\n\
//matrices\n\
uniform mat4 u_model;\n\
uniform mat4 u_normal_model;\n\
uniform mat4 u_view;\n\
uniform mat4 u_viewprojection;\n\
uniform mat4 u_mvp;\n\
\n\
//globals\n\
uniform float u_time;\n\
uniform vec4 u_viewport;\n\
uniform float u_point_size;\n\
\n\
//camera\n\
uniform vec3 u_camera_eye;\n\
void main() {\n\
	\n\
	vec4 vertex4 = vec4(a_vertex,1.0);\n\
	v_normal = a_normal;\n\
	v_uvs = a_coord;\n\
	\n\
	//vertex\n\
	v_pos = (u_model * vertex4).xyz;\n\
	//normal\n\
	v_normal = (u_normal_model * vec4(v_normal,1.0)).xyz;\n\
	gl_Position = u_viewprojection * vec4(v_pos,1.0);\n\
}\n\
\n\
\\default.fs\n\
\n\
precision mediump float;\n\
//varyings\n\
varying vec3 v_pos;\n\
varying vec3 v_normal;\n\
varying vec2 v_uvs;\n\
//globals\n\
uniform vec4 u_clipping_plane;\n\
uniform float u_time;\n\
uniform vec3 u_background_color;\n\
uniform vec3 u_ambient_light;\n\
\n\
//material\n\
uniform vec4 u_material_color; //color and alpha\n\
void main() {\n\
	gl_FragColor = u_material_color;\n\
}\n\
\n\
";

LS.ShaderCode = ShaderCode;
LS.registerResourceClass( ShaderCode );