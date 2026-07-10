import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolsPath = path.join(__dirname, 'tools');


/*
export const tools = () => {
    const tools = {};
    // Dynamically import all tool classes from the tools directory
    const toolModules = import.meta.glob('./tools/*.js', { eager: true });
    for (const path in toolModules) {
        const module = toolModules[path];
        const ToolClass = module.default;
        const toolInstance = new ToolClass();
        tools[toolInstance.name] = toolInstance;
    }
    return tools;
};
*/

export async function tools() {
    const toolInstances = [];

    // 1. Read directory RECURSIVELY (New in Node 20)
    // This finds tools/xyz.js AND tools/subfolder/abc.js
    const files = await fs.readdir(toolsPath, { 
        recursive: true, 
        withFileTypes: true 
    });

    for (const file of files) {
        // 2. Check if it is a file and ends with .js
        if (file.isFile() && file.name.endsWith('.js')) {
            
            // 3. Reconstruct full path (needed because recursive search returns relative paths)
            const fullPath = path.join(file.parentPath || file.path, file.name);
            const fileUrl = pathToFileURL(fullPath).href;

            try {
                const module = await import(fileUrl);
                const ToolClass = module.default;

                if (ToolClass && typeof ToolClass === 'function') {
                    toolInstances.push(new ToolClass());
                }
            } catch (e) {
                console.error(`Skipping ${file.name}:`, e.message);
            }
        }
    }
    console.log(`Loaded ${toolInstances.length} tools.`);
    return toolInstances;
}
