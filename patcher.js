#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const crypto = require('crypto');
const readline = require('readline');

// ANSI颜色代码
const GREEN = "\x1b[92m";
const RED = "\x1b[91m";
const YELLOW = "\x1b[93m";
const BLUE = "\x1b[96m";
const PURPLE = "\x1b[95m";
const RESET = "\x1b[0m";
const REVERSE = "\x1b[7m";
const NO_REVERSE = "\x1b[27m";

// 系统检测
const SYSTEM = process.platform === 'win32' ? 'Windows' : 
               process.platform === 'darwin' ? 'Darwin' : 
               process.platform === 'linux' ? 'Linux' : null;

if (!SYSTEM || !['Windows', 'Linux', 'Darwin'].includes(SYSTEM)) {
    console.log(`${RED}[ERR] 不支持的操作系统: ${process.platform}${RESET}`);
    process.exit(1);
}

// 创建readline接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 辅助函数
function randomUuid() {
    return crypto.randomUUID();
}

function generateRandomMac() {
    const hexDigits = "0123456789ABCDEF";
    let macAddress = "";
    for (let i = 0; i < 6; i++) {
        macAddress += hexDigits.charAt(Math.floor(Math.random() * 16));
        macAddress += hexDigits.charAt(Math.floor(Math.random() * 16));
        if (i < 5) macAddress += ":";
    }
    return macAddress;
}

function resolveFullPath(filePath) {
    if (!filePath) return filePath;
    return path.resolve(filePath.trim().replace(/^['"]|['"]$/g, ''));
}

function removeReadonly(filePath) {
    try {
        if (SYSTEM === 'Windows') {
            fs.chmodSync(filePath, 0o666);
        }
    } catch (error) {
        // 忽略错误
    }
}

function backupFile(filePath, force = false) {
    console.log(`\n> 备份 '${path.basename(filePath)}'`);
    const backupPath = `${filePath}.bak`;
    
    if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(filePath, backupPath);
        console.log(`${GREEN}[√] 已创建备份: '${path.basename(backupPath)}'${RESET}`);
    } else if (force) {
        fs.copyFileSync(filePath, backupPath);
        console.log(`${GREEN}[√] 已更新备份: '${path.basename(backupPath)}'${RESET}`);
    } else {
        console.log(`${BLUE}[i] 备份 '${path.basename(backupPath)}' 已存在，很好${RESET}`);
    }
}

function loadFile(filePath) {
    try {
        return fs.readFileSync(filePath);
    } catch (error) {
        console.log(`${RED}[ERR] 读取文件失败: ${error.message}${RESET}`);
        process.exit(1);
    }
}

function saveFile(filePath, data) {
    console.log(`\n> 保存 ${filePath}`);
    try {
        fs.writeFileSync(filePath, data);
        console.log(`${GREEN}[√] 文件已保存${RESET}`);
    } catch (error) {
        console.log(`${RED}[ERR] 文件 '${filePath}' 正在使用中，请关闭它并重试${RESET}`);
        pause();
        process.exit(1);
    }
}

function checkPatched(data, probes) {
    return probes.some(probe => data.includes(probe));
}

function replaceInFile(data, pattern, replacement, probe) {
    // 转换为字符串进行处理
    if (Buffer.isBuffer(data)) {
        data = data.toString();
    }
    
    // 将字符串参数转换为适当的形式
    const patternStr = typeof pattern === 'string' ? pattern : pattern.source;
    const probeStr = typeof probe === 'string' ? probe : (probe ? probe.source : '');
    
    // 构建正则表达式（确保有's'标志以匹配多行）
    const regex = new RegExp(patternStr, 's');
    const probeRegex = probeStr ? new RegExp(probeStr, 's') : null;
    
    console.log(`> ${patternStr} => ${replacement}`);
    
    // 计算匹配和已修补的数量
    let matches = data.match(regex);
    const count = matches ? matches.length : 0;
    
    let patchedMatches = [];
    if (probeRegex) {
        patchedMatches = data.match(probeRegex) || [];
    }
    const patchedCount = patchedMatches.length;
    
    // 如果没有找到匹配
    if (count === 0) {
        if (patchedCount > 0) {
            console.log(`${BLUE}[i] 发现 ${patchedCount} 个已修补的模式，将覆盖${RESET}`);
        } else {
            console.log(`${YELLOW}[WARN] 未找到模式 <${patternStr}>，已跳过！${RESET}`);
            return Buffer.from(data);
        }
    }
    
    // 执行替换
    let newData = data;
    
    // 首先替换已修补的部分
    if (patchedCount > 0 && probeRegex) {
        newData = newData.replace(probeRegex, replacement);
    }
    
    // 然后替换新的匹配
    newData = newData.replace(regex, replacement);
    
    // 检查是否成功替换所有匹配
    let replacedCount = 0;
    const checkRegex = new RegExp(patternStr, 'g');
    const match = data.match(checkRegex);
    if (match) {
        replacedCount = match.length;
    }
    
    if (replacedCount > 0 && newData === data) {
        console.log(`${YELLOW}[WARN] 已修补 0/${replacedCount}，失败 ${replacedCount}${RESET}`);
    } else {
        console.log(`${GREEN}[√] 已修补 ${replacedCount} 个模式${RESET}`);
    }
    
    return Buffer.from(newData);
}

// Linux特定功能
function findAppImage() {
    const searchPaths = [
        '/usr/local/bin',
        '/opt',
        path.join(os.homedir(), 'Applications'),
        path.join(os.homedir(), '.local/bin'),
        path.join(os.homedir(), 'Downloads'),
        path.join(os.homedir(), 'Desktop'),
        os.homedir(),
        '.'
    ];
    
    // 添加PATH环境变量中的路径
    if (process.env.PATH) {
        searchPaths.push(...process.env.PATH.split(path.delimiter));
    }
    
    for (const searchPath of searchPaths) {
        try {
            const files = fs.readdirSync(searchPath);
            for (const file of files) {
                const filePath = path.join(searchPath, file);
                const fileStat = fs.statSync(filePath);
                
                if (fileStat.isFile() && 
                    file.toLowerCase().startsWith('cursor') && 
                    !/^cursor[a-z]/i.test(file) && 
                    file.toLowerCase().endsWith('.appimage')) {
                    return filePath;
                }
            }
        } catch (error) {
            // 忽略错误，继续搜索
        }
    }
    
    return null;
}

function unpackAppImage(appImagePath) {
    const appImageName = path.basename(appImagePath);
    const targetAppImagePath = path.join('.', appImageName);
    const squashFsRoot = path.join('.', 'squashfs-root');
    
    // 如果AppImage不在当前目录，复制过来
    if (appImagePath !== targetAppImagePath) {
        fs.copyFileSync(appImagePath, targetAppImagePath);
    }
    
    // 设置执行权限并解包
    execSync(`chmod +x ${targetAppImagePath}`);
    try {
        execSync(`${targetAppImagePath} --appimage-extract`);
    } catch (error) {
        console.log(`${RED}[ERR] 解包AppImage失败${RESET}`);
        process.exit(1);
    }
    
    // 如果AppImage是复制过来的，删除临时文件
    if (appImagePath !== targetAppImagePath) {
        fs.unlinkSync(targetAppImagePath);
    }
    
    console.log(`${GREEN}[√] AppImage已解包 -> ${squashFsRoot}${RESET}`);
    return squashFsRoot;
}

function detectJsPathInAppImage(appImageUnpacked) {
    const jsPaths = [
        "resources/app/out/main.js",
        "usr/share/cursor/resources/app/out/main.js"
    ];
    
    for (const p of jsPaths) {
        const jsPath = path.join(appImageUnpacked, p);
        if (fs.existsSync(jsPath)) {
            return jsPath;
        }
    }
    
    console.log(`${RED}[ERR] 在${appImageUnpacked}中未找到main.js${RESET}`);
    pause();
    process.exit(1);
}

function repackAppImage(appImagePath, extractPath) {
    console.log(`\n> 重新打包AppImage`);
    
    // 检查是否安装了wget
    try {
        if (SYSTEM === 'Windows') {
            execSync('where wget');
        } else {
            execSync('which wget');
        }
    } catch (error) {
        console.log(`${RED}[ERR] 请先安装wget${RESET}`);
        process.exit(1);
    }
    
    const appImageTool = path.join('.', 'appimagetool');
    const appImageToolDownloading = path.join('.', 'appimagetool_downloading');
    
    // 删除下载中的文件（如果存在）
    if (fs.existsSync(appImageToolDownloading)) {
        fs.unlinkSync(appImageToolDownloading);
    }
    
    // 如果appimagetool不存在，下载它
    if (!fs.existsSync(appImageTool)) {
        console.log(`${YELLOW}[WARN] 未找到appimagetool${RESET}`);
        
        const downloadTool = () => {
            console.log(`${BLUE}[i] 正在下载appimagetool...${RESET}`);
            try {
                execSync(`wget https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage -O ${appImageToolDownloading}`);
                execSync(`chmod +x ${appImageToolDownloading}`);
                fs.renameSync(appImageToolDownloading, appImageTool);
                console.log(`${GREEN}[√] appimagetool已下载${RESET}`);
                continueRepack();
            } catch (error) {
                console.log(`${RED}[ERR] 下载失败，你可以手动下载并保存到./appimagetool\n链接: ${RESET}https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage`);
                if (fs.existsSync(appImageToolDownloading)) {
                    fs.unlinkSync(appImageToolDownloading);
                }
                process.exit(1);
            }
        };
        
        rl.question(`${PURPLE}下载appimagetool? (Y/n): ${RESET}`, (answer) => {
            if (answer.toLowerCase() !== 'n') {
                downloadTool();
            } else {
                console.log(`${RED}[ERR] 请下载appimagetool并将其放到./appimagetool以继续\n链接: ${RESET}https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage`);
                process.exit(1);
            }
        });
    } else {
        continueRepack();
    }
    
    function continueRepack() {
        try {
            execSync(`${appImageTool} ${extractPath} ${appImagePath}`);
            console.log(`${GREEN}[√] AppImage已重新打包，覆盖 ${RESET}${appImagePath}\n${GREEN} -- 不用担心，我们已经备份了 ${RESET}${appImagePath}.bak`);
            
            // 清理临时目录
            fs.rmSync(extractPath, { recursive: true, force: true });
            console.log(`${GREEN}[√] 已删除临时目录 ${extractPath}${RESET}`);
            
            // 继续主程序流程
            pause();
        } catch (error) {
            console.log(`${RED}[ERR] 重新打包AppImage失败${RESET}`);
            process.exit(1);
        }
    }
}

// macOS特定功能
function moveAppBundleToTemp(appBundle) {
    if (!fs.existsSync(appBundle)) {
        console.log(`${RED}[ERR] 未找到App Bundle '${appBundle}'${RESET}`);
        process.exit(1);
    }
    
    const appBundleTemp = `${appBundle}.tmp`;
    
    // 如果临时目录存在，删除它
    if (fs.existsSync(appBundleTemp)) {
        fs.rmSync(appBundleTemp, { recursive: true, force: true });
    }
    
    // 复制App Bundle到临时目录
    execSync(`cp -R "${appBundle}" "${appBundleTemp}"`);
    console.log(`${GREEN}[√] App Bundle已移动到 ${appBundleTemp}${RESET}`);
    
    return appBundleTemp;
}

function moveAppBundleBack(appBundleTemp, appBundle) {
    // 删除原始App Bundle
    fs.rmSync(appBundle, { recursive: true, force: true });
    
    // 移动临时App Bundle回原位
    fs.renameSync(appBundleTemp, appBundle);
    console.log(`${GREEN}[√] App Bundle已移回 ${appBundle}${RESET}`);
}

function unsignAppBundle(appBundle) {
    try {
        execSync(`codesign --remove-signature "${appBundle}"`);
        console.log(`${GREEN}[√] App Bundle签名已移除${RESET}`);
    } catch (error) {
        console.log(`${RED}[ERR] 移除App Bundle签名失败${RESET}`);
        process.exit(1);
    }
}

function signAppBundle(appBundle) {
    try {
        execSync(`codesign --force --deep --sign - "${appBundle}"`);
        console.log(`${GREEN}[√] App Bundle已重新签名${RESET}`);
    } catch (error) {
        console.log(`${RED}[ERR] 重新签名App Bundle失败${RESET}`);
        process.exit(1);
    }
}

function getAppBundleFromJsPath(jsPath) {
    // 例如：/Applications/Cursor.app/Contents/Resources/app/out/main.js
    const match = jsPath.match(/(.+?\.app)/i);
    if (match) {
        return match[1];
    }
    return null;
}

function getJsPathFromAppBundle(appBundle) {
    return path.join(appBundle, 'Contents/Resources/app/out/main.js');
}

// 自动查找main.js路径
function findJsPath(customPath) {
    if (!customPath) {
        // 模拟Python版本的apppath函数
        let jsPath;
        
        function isValidAppPath(basePath) {
            return fs.existsSync(path.join(basePath, 'out', 'main.js'));
        }
        
        function findCursorInPath() {
            if (!process.env.PATH) return null;
            
            const paths = process.env.PATH.split(path.delimiter);
            for (const p of paths) {
                try {
                    const cursorBin = path.join(p, 'cursor');
                    const app = path.dirname(p);
                    
                    if (fs.existsSync(cursorBin) && isValidAppPath(app)) {
                        return app;
                    }
                } catch (error) {
                    continue;
                }
            }
            return null;
        }
        
        if (SYSTEM === 'Windows') {
            const localAppData = process.env.LOCALAPPDATA;
            if (!localAppData) {
                console.log(`${RED}[ERR] %LOCALAPPDATA% 不存在${RESET}`);
                process.exit(1);
            }
            
            const defaultPath = path.join(localAppData, 'Programs', 'cursor', 'resources', 'app');
            if (isValidAppPath(defaultPath)) {
                jsPath = path.join(defaultPath, 'out', 'main.js');
            } else {
                const cursorPath = findCursorInPath();
                if (cursorPath) {
                    jsPath = path.join(cursorPath, 'out', 'main.js');
                }
            }
        } else if (SYSTEM === 'Darwin') {
            const defaultPath = '/Applications/Cursor.app/Contents/Resources/app';
            if (isValidAppPath(defaultPath)) {
                jsPath = path.join(defaultPath, 'out', 'main.js');
            } else {
                const cursorPath = findCursorInPath();
                if (cursorPath) {
                    jsPath = path.join(cursorPath, 'out', 'main.js');
                }
            }
        }
        
        if (!jsPath) {
            console.log(`${RED}[ERR] 找不到Cursor，请手动输入main.js路径${RESET}`);
            pause();
            process.exit(1);
        }
        
        if (!fs.existsSync(jsPath)) {
            console.log(`${RED}[ERR] main.js在默认路径 '${jsPath}' 中不存在${RESET}`);
            pause();
            process.exit(1);
        }
        
        console.log(`${GREEN}[√]${RESET} ${jsPath}`);
        return jsPath;
    } else {
        const jsPath = resolveFullPath(customPath);
        if (!fs.existsSync(jsPath)) {
            console.log(`${RED}[ERR] 文件 '${jsPath}' 不存在${RESET}`);
            pause();
            process.exit(1);
        }
        return jsPath;
    }
}

// 暂停函数
function pause() {
    rl.question(`\n${REVERSE}按Enter继续...${NO_REVERSE}`, () => {
        rl.close();
    });
}

// 主程序
console.log(`
${RED}<== ${PURPLE}[${RESET}Cursor Shadow Patch${PURPLE}]${RED} ==>${RESET}

- 自定义机器ID、MAC地址等。`);

// 更改工作目录到脚本所在目录
process.chdir(path.dirname(process.argv[1]));

let appImage = null;
let appImageUnpacked = null;
let js = null;

// 根据平台处理
if (SYSTEM === 'Linux') {
    rl.question(`\n${PURPLE}输入AppImage路径: ${RESET}(留空 = 自动检测) `, (answer) => {
        appImage = answer ? resolveFullPath(answer) : findAppImage();
        if (!appImage) {
            console.log(`${RED}[ERR] 未找到Cursor AppImage，请手动输入AppImage路径${RESET}`);
            process.exit(1);
        }
        
        appImageUnpacked = unpackAppImage(appImage);
        js = detectJsPathInAppImage(appImageUnpacked);
        
        processMainJs();
    });
} else {
    rl.question(`\n${PURPLE}输入main.js路径: ${RESET}(留空 = 自动检测) `, (answer) => {
        js = findJsPath(answer);
        processMainJs();
    });
}

function processMainJs() {
    const data = loadFile(js);
    const isPatched = checkPatched(data, ['/*csp1*/', '/*csp2*/', '/*csp3*/', '/*csp4*/']);
    
    rl.question(`\n${PURPLE}MachineId: ${RESET}(留空 = 随机uuid) `, (answer) => {
        const machineId = answer || randomUuid();
        if (!answer) console.log(machineId);
        
        // 替换machineId
        let newData = replaceInFile(
            data,
            /=.{0,50}timeout.{0,10}5e3.*?,/,
            `=/*csp1*/"${machineId}"/*1csp*/,`,
            /\/\*csp1\*\/.*?\/\*1csp\*\/,/
        );
        
        rl.question(`\n${PURPLE}Mac地址: ${RESET}(留空 = 随机mac) `, (answer) => {
            const mac = answer || generateRandomMac();
            if (!answer) console.log(mac);
            
            // 替换MAC地址 - 尝试多种模式
            const macPatterns = [
                // 原始Python版本使用的模式
                {
                    pattern: "(function .{0,50}\\{).{0,300}Unable to retrieve mac address.*?(\\})",
                    replacement: `$1return/*csp2*/"${mac}"/*2csp*/;$2`,
                    probe: "()return/\\*csp2\\*/.*?/\\*2csp\\*/;()"
                },
                // 更宽松的模式1
                {
                    pattern: "function[\\s\\S]*?getMacAddress[\\s\\S]*?\\{[\\s\\S]*?Unable[\\s\\S]*?mac address[\\s\\S]*?\\}",
                    replacement: `function getMacAddress() {return/*csp2*/"${mac}"/*2csp*/;}`,
                    probe: null
                },
                // 更宽松的模式2
                {
                    pattern: "function[\\s\\S]*?\\{[\\s\\S]*?networkInterfaces[\\s\\S]*?mac[\\s\\S]*?\\}",
                    replacement: `function getMacAddress() {return/*csp2*/"${mac}"/*2csp*/;}`,
                    probe: null
                }
            ];
            
            // 尝试每一种模式
            let macReplaced = false;
            for (const p of macPatterns) {
                const result = replaceInFile(newData, p.pattern, p.replacement, p.probe);
                // 检查是否成功替换
                if (result.toString() !== newData.toString()) {
                    newData = result;
                    macReplaced = true;
                    break;
                }
            }
            
            if (!macReplaced) {
                console.log(`${RED}[ERR] 所有MAC地址替换模式都失败！继续执行其他步骤...${RESET}`);
            }
            
            rl.question(`\n${PURPLE}Windows SQM Id: ${RESET}(留空 = 空) `, (answer) => {
                const sqm = answer || '';
                if (!answer) console.log(sqm);
                
                // 替换SQM ID
                newData = replaceInFile(
                    newData,
                    /return.{0,50}\.GetStringRegKey.*?HKEY_LOCAL_MACHINE.*?MachineId.*?\|\|.*?""/,
                    `return/*csp3*/"${sqm}"/*3csp*/`,
                    /return\/\*csp3\*\/.*?\/\*3csp\*\//
                );
                
                rl.question(`\n${PURPLE}devDeviceId: ${RESET}(留空 = 随机uuid) `, (answer) => {
                    const devId = answer || randomUuid();
                    if (!answer) console.log(devId);
                    
                    // 替换设备ID
                    newData = replaceInFile(
                        newData,
                        /return.{0,50}vscode\/deviceid.*?getDeviceId\(\)/,
                        `return/*csp4*/"${devId}"/*4csp*/`,
                        /return\/\*csp4\*\/.*?\/\*4csp\*\//
                    );
                    
                    // macOS平台特殊处理
                    let appBundle = null;
                    let appBundleTemp = null;
                    
                    if (SYSTEM === 'Darwin') {
                        appBundle = getAppBundleFromJsPath(js);
                        if (appBundle) {
                            backupFile(appBundle, !isPatched);
                            appBundleTemp = moveAppBundleToTemp(appBundle);
                            unsignAppBundle(appBundleTemp);
                            js = getJsPathFromAppBundle(appBundleTemp);
                        }
                    }
                    
                    // Windows平台特殊处理
                    if (SYSTEM === 'Windows') {
                        removeReadonly(path.dirname(js));
                        removeReadonly(js);
                    }
                    
                    // 备份并保存
                    backupFile(js, !isPatched);
                    saveFile(js, newData);
                    
                    // macOS平台后处理
                    if (SYSTEM === 'Darwin' && appBundle && appBundleTemp) {
                        signAppBundle(appBundleTemp);
                        moveAppBundleBack(appBundleTemp, appBundle);
                    }
                    
                    // Linux平台特殊处理
                    if (SYSTEM === 'Linux' && appImage && appImageUnpacked) {
                        backupFile(appImage, !isPatched);
                        repackAppImage(appImage, appImageUnpacked);
                    } else {
                        pause();
                    }
                });
            });
        });
    });
} 