/**
 * 发版客户端脚本
 */

var fs = require("fs");
var path = require("path");
var {log,end,cmd,getArgs} = require("ifun");
var ex = require("./ex");

var config = {};
var args = {};
var ua = {};

var src;
var mid;
var pub;
var next;
var ips;

var local;  //本地参数
var remote; //远程参数

var pubIndex = -1;
var pubCount = 0;

var cmdList;
var tarFile;
var sshArgs;
var isShow;

//cmd对外接口
var cmdFun = function(cmdExp) {
    cmdList.push(cmdExp);
};

var getDateTime = function(){
    var timestamp = Date.now() - new Date().getTimezoneOffset()*60000;
    return new Date(timestamp).toISOString().replace(/:[^:]*$/,"").replace(/\W/g,"").replace("T","_");
};

//获取参数
var getParams = function(){
    var remote = [];
    if(mid){
        log({next:src.next});
        delete mid[src.next];
        log({mid});
        for(let m in mid){
            let item = mid[m];
            for (let k in item) {
                item[k] && remote.push(`mid.${m}.${k}=${item[k]}`);
            }
        }
    }

    for(let k in pub){
        pub[k] && typeof(pub[k])!="object" && remote.push(`pub.${k}=${pub[k]}`);
    }
    remote = remote.join(" ");


    if(next){
        src = {
            puber: src.puber,
            dir: next.dir,
            rose: next.rose,
            //env: next.env
        };
        if(next.keyDir) {
            src.keyDir = next.keyDir;
        }
    }

    var local = [];
    for(let k in src){
        src[k] && local.push(`${k}=${src[k]}`);
    }
    local = local.join(" ");

    return {local,remote};
};

//上传前检查
var chkPubBefore = function(){
    config.onPubBefore && !args.onlyPub && config.onPubBefore(cmdFun);
    cmdList.length>0 ? runCmd() : startPub();
};

//上传前循环执行命令
var runCmd = function() {
    var cmdExp = cmdList.shift();
    if(cmdExp) {
        cmd(cmdExp, src.dir, code => {
            if (code == 0) {
                runCmd();
            } else {
                log("pub before fail!");
            }
        });
    }else{
        log("pub before success!");
        startPub();
    }
};

//获取所有的Node依赖文件
var getNodeDeps = function(currentFile, deps, isLoaded){
    if(isLoaded[currentFile]){
        return [];
    }else{
        isLoaded[currentFile] = true;
        deps.push(currentFile);
        fs.getFileSync(currentFile).replace(/require\((.+?)\)/g, function(_,file){
            var subDeps = getNodeDeps(file, deps, isLoaded);
            deps = deps.concat(subDeps);
        });
    }
    return deps;
};

//开始上传
var startPub = function(){
    next = mid[src.next] || pub;
    ips = next.ip.split(",");
    pubIndex = 0;
    pubCount = ips.length;

    tarFile = `${src.dir}/bin.tar.gz`;
    if(src.rose=="pack"){
        pack();
    }else {
        publishBegin();
    }
};

//打包
var pack = function(){
    var source = pub.packages || [];
    pub.staticDir && source.push(pub.staticDir);
    pub.nodeDir && source.push(pub.nodeDir);

    if(source.length>0) {
        var configFile = `${src.dir}/nobox.config.js`;
        if(fs.existsSync(configFile)){
            source.push("nobox.config.js");
            /*
            var deps = getNodeDeps("./nobox.config", [], {});
            log(deps);
            source = source.concat(deps);
            */
        }
        source = source.join(" ");
        var cmdExp = `tar -zcf ${tarFile} ${source}`;
        cmd(cmdExp, src.dir, publishBegin);
    }else{
        log("source is empty");
    }
};

//获取key
var getSshKey = function(key,dir){
    if(key){
        if(dir){
            key = `${dir}/${key}`;
        }
        if (fs.existsSync(key)) {
            var mode = fs.statSync(key).mode.toString(8);
            if (/[40]{3}$/.test(mode)) {
                return `-i ${key}`;
            } else {
                end(`the key file must locked, please use the "chmod" command to change mode!`)
            }
        } else {
            end(`the key path "${key}" is no exist!`)
        }
    }
    return "";
};

//数字to第几
var getTh = function(n){
    return n + ([0,"st","nd","rd"][n]||"th");
};

//开始发版
var publishBegin = function(){
    args.show && log({pubIndex,pubCount,currentOption:mid?"local-mid":"mid-pro"});
    if(pubCount>1){
        log(`\n===================================\n`);
        log(`now is publishing the ${getTh(pubIndex+1)} machine:`);
    }
    sshArgs = getSshKey(next.key, src.keyDir);
    uploadPackage();
};

//上传压缩包
var uploadPackage = function() {
    log(`uploading...`);

    if(args.parallel) {
        cmd(`cp ${tarFile} ${pub.dir}/bin.tar.gz`, uploadPackageFinish);
    }else{
        var ip = ips[pubIndex];
        var cmdExp = `scp ${sshArgs} ${tarFile} ${next.user}@${ip}:${next.dir}/bin.tar.gz`;
        cmd(cmdExp, src.dir, uploadPackageFinish);
    }
};

//上传压缩包完成
var uploadPackageFinish = function(code) {
    if(code!=0){
        end("upload fail!");
    }
    publish();
};

//远程登录发版
var login2pub = function(){
    var sshKey = getSshKey(mid.key);
    var cmdExp = `ssh ${sshKey} ${mid.user}@${mid.ip} "nobox pub ${args.env} ${isShow} dir=${mid.gitDir} user=${ua.user}"`;
    log("step1: local===>testPub");
    cmd(cmdExp, src.dir, publishFinish);
};

//发版
var publish = function(){
    log(`publishing...`);

    var cmdExp;
    var ip = ips[pubIndex];
    if (mid) {
        var key = mid.key ? `pub.key=${pub.key}` : '';
        var {local,remote} = getParams();

        cmdExp = `nobox pub ${args.env} ${isShow} ${key} ${local} ${remote}`;
        cmdExp = `ssh ${sshArgs} ${next.user}@${ip}`.split(/\s+/).concat(`"${cmdExp}"`);
    } else {
        var time = getDateTime();
        var date = time.split("_")[0];
        cmdExp = `nohup nobox deploy port=${pub.port} env=${args.env} dir=${pub.dir} time=${time} user=${args.user} ${isShow} > ${pub.dir}/logs/${date}.log 2>&1 &`;
        if(!pub.isParallel){
            cmdExp = `ssh ${sshArgs} ${pub.user}@${ip}`.split(/\s+/).concat(`"${cmdExp}"`);
        }
    }
    cmd(cmdExp, src.dir, publishFinish);
};

//发版完成
var publishFinish = function(code){
    if(code!=0){
        end("publish fail!");
    }
    if(pubCount>1) {
        log(`the ${getTh(pubIndex+1)} machine publish finish!`);
        pubIndex++;
        if (pubIndex < pubCount) {
            return publishBegin();
        }
    }
    cmd(`rm -rf ${tarFile}`, src.dir);
    log("publish success!");
};

//分析线路
var parseLine = function(){
    var items = {};
    var item = src = items.src = pub.src || {};
    src.rose = "pack";
    src.puber = args.puber || ua.user;
    mid = pub.mid;
    for(let m in mid){
        item.next = m;
        item = mid[m];
        item.rose = "upload";
        if(item.rose=="pack"){
            for (let m2 in items) {
                items[m2].rose = "login";
            }
        }
        items[m] = item;
    }
    item.next = args.env;
    pub.rose = "deploy";
    pub.src = null;
    pub.mid = null;
    log({src,mid,pub});
};

module.exports = function(_ua) {
    ua = _ua;
    args = getArgs("cmd", "env");
    isShow = args.show ? "--show" : "";

    cmdList = [];

    if (!args.env) {
        end("please select a environment before!");
    }

    try {
        args.currentBranch = cmd("git rev-parse --abbrev-ref HEAD", src.dir);
    }catch(e){}

    config = ex.getConfig(args, ua);
    pub = config.pub || args.pub;
    if(!pub) {
        throw "please setting publish option 'pub' before!";
    }
    parseLine();

    if (!pub.dir) {
        throw "please setting option 'pub.dir' before!";
    }
    if(!args.parallel && !pub.ip){
        throw "please setting option 'pub.ip' before!";
    }
    args.show && log({config});
    src.rose=="pack" ? chkPubBefore() : publishBegin();
};