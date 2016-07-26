var fs = require("fs");
var cp = require("child_process");
var ex = require("../core/ex");

//获取参数列表
exports.getArgs = function(argv) {
    var args = {};
    args.more = [];
    args.ip = ex.getIp();
    argv.forEach(function(kv){
        kv = kv.split("=");
        var k = kv[0];
        var v = kv[1];
        if(kv.length==2){
            args[k] = v;
        }else if(/^\-\-(\w+)$/.test(k)){
            args[RegExp.$1] = true;
        }else if(/^\-(\w+)$/.test(k)){
            RegExp.$1.split("").forEach(function(k2){
                args[k2] = true;
            });
        }else{
            args.more.push(k);
        }
    });
    return args;
};

//获取配置信息
exports.getConfig = function(args, ops) {
    var config = {};
    var configFile = `${ops.currentPath}${ops.pk.name}.config.js`;
    var hasFile = fs.existsSync(configFile);
    if (hasFile) {
        config = require(configFile);
        if (typeof config == "function") {
            config = config(args);
        }
    }
    config.hasFile = hasFile;
    return config;
};

//spawn封装
exports.spawn = function(cmdExp, callback) {
    var args = cmdExp;
    if(typeof args=="string") {
        args = args.split(/\s+/);
    }
    var cmd = args.shift();
    if(cmd=="npm" && process.platform=="win32"){
        cmd = "npm.cmd"
    }
    var ls = cp.spawn(cmd, args, {shell: true});

    ls.stdout.on('data', (data) => {
        var str = data.toString();
        console.log(str);
    });

    ls.stderr.on('data', (data) => {
        var str = data.toString();
        !str.includes("not in PATH env variable") && process.stderr.write(data);
    });

    ls.on('close', callback);
};

//获取进程ID
//如找不到pid返回0
exports.getPid = function(keywords){
    var ps = process.platform=="linux" ? "ps -aux" : "ps aux";
    var stdout = cp.execSync(ps).toString().trim();

    var plist = stdout.split('\n');
    var pid = 0;
    plist.some(function(line) {
        var isMatch = keywords.every(function(keyword){
            return line.includes(keyword);
        });
        if(isMatch) {
            var _pid = line.trim().split(/\s+/)[1];
            if(_pid == process.pid){
                isMatch = false;
            }else{
                pid = _pid;
            }
        }
        return isMatch;
    });
    return pid;
};

//杀进程
exports.kill = function(pid){
    cp.execSync(`kill -9 ${pid}`)
};

//解压缩
exports.unTar = function(tarFile, unTarDir){
    cp.execSync(`tar -zxf ${tarFile} -C ${unTarDir}/`.replace(/\/\/$/,"/"));
};