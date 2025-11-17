
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

// koa-smart-server - Enhanced version with security fixes and improved error handling
// Version: 2.0.0
// Fixes applied:
// - Path Traversal vulnerability protection
// - Status code 404 properly set
// - Template rendering error handling
// - Race condition file access protection
// - Proper file extension extraction
// - fs.readdirSync error handling
// - Content-Disposition properly quoted
// - Code quality improvements

module.exports = function koaClassicServer(
    rootDir,
    opts = {}
    /*
    opts STRUCTURE
     opts = {
        method: ['GET'], // Supported methods, otherwise next() will be called
        showDirContents: true, // Show or hide directory contents
        index: "", // Index file name
        urlPrefix: "", // URL path prefix
        urlsReserved: [], // Reserved paths (first level only)
        template: {
            render: undefined, // Template rendering function: async (ctx, next, filePath) => {}
            ext: [], // File extensions to process with template.render
        },
    }
    */
) {
    // Validate rootDir
    if (!rootDir || typeof rootDir !== 'string') {
        throw new TypeError('rootDir must be a non-empty string');
    }
    if (!path.isAbsolute(rootDir)) {
        throw new Error('rootDir must be an absolute path');
    }

    // Normalize rootDir to prevent issues
    const normalizedRootDir = path.resolve(rootDir);

    // Set default options
    const options = opts || {};
    options.template = opts.template || {};

    options.method = Array.isArray(options.method) ? options.method : ['GET'];
    options.showDirContents = typeof options.showDirContents == 'boolean' ? options.showDirContents : true;
    options.index = typeof options.index == 'string' ? options.index : "";
    options.urlPrefix = typeof options.urlPrefix == 'string' ? options.urlPrefix : "";
    options.urlsReserved = Array.isArray(options.urlsReserved) ? options.urlsReserved : [];
    options.template.render = (options.template.render == undefined || typeof options.template.render == 'function') ? options.template.render : undefined;
    options.template.ext = Array.isArray(options.template.ext) ? options.template.ext : [];

    return async (ctx, next) => {
        // Check if method is allowed
        if (!options.method.includes(ctx.method)) {
            await next();
            return;
        }

        // Normalize URL (remove trailing slash)
        let pageHref = '';
        if (ctx.href.charAt(ctx.href.length - 1) == '/') {
            pageHref = new URL(ctx.href.slice(0, -1));
        } else {
            pageHref = new URL(ctx.href);
        }

        // Check URL prefix
        const a_pathname = pageHref.pathname.split("/");
        const a_urlPrefix = options.urlPrefix.split("/");

        for (const key in a_urlPrefix) {
            if (a_urlPrefix[key] != a_pathname[key]) {
                await next();
                return;
            }
        }

        // Create pageHrefOutPrefix without URL prefix
        let pageHrefOutPrefix = pageHref;
        if (options.urlPrefix != "") {
            let a_pathnameOutPrefix = a_pathname.slice(a_urlPrefix.length);
            let s_pathnameOutPrefix = a_pathnameOutPrefix.join("/");
            let hrefOutPrefix = pageHref.origin + '/' + s_pathnameOutPrefix;
            pageHrefOutPrefix = new URL(hrefOutPrefix);
        }

        // Check reserved URLs (first level only)
        if (Array.isArray(options.urlsReserved) && options.urlsReserved.length > 0) {
            const a_pathnameOutPrefix = pageHrefOutPrefix.pathname.split("/");
            for (const value of options.urlsReserved) {
                if (a_pathnameOutPrefix[1] == value.substring(1)) {
                    await next();
                    return;
                }
            }
        }

        // FIX #1: Path Traversal Protection
        // Construct safe file path
        let requestedPath = "";
        if (pageHrefOutPrefix.pathname == "/") {
            requestedPath = "";
        } else {
            requestedPath = decodeURIComponent(pageHrefOutPrefix.pathname);
        }

        // Normalize path and prevent path traversal
        const normalizedPath = path.normalize(requestedPath);
        const fullPath = path.join(normalizedRootDir, normalizedPath);

        // Security check: ensure resolved path is within rootDir
        if (!fullPath.startsWith(normalizedRootDir)) {
            ctx.status = 403;
            ctx.body = 'Forbidden';
            return;
        }

        let toOpen = fullPath;

        // FIX #2: Status Code 404 - Check if file/directory exists
        if (!fs.existsSync(toOpen)) {
            ctx.status = 404; // FIX: Set proper status code
            ctx.body = requestedUrlNotFound();
            return;
        }

        let stat;
        try {
            stat = fs.statSync(toOpen);
        } catch (error) {
            console.error('fs.statSync error:', error);
            ctx.status = 500;
            ctx.body = 'Internal Server Error';
            return;
        }

        if (stat.isDirectory()) {
            // Handle directory
            if (options.showDirContents) {
                if (options.index) {
                    const indexPath = path.join(toOpen, options.index);
                    if (fs.existsSync(indexPath)) {
                        await loadFile(indexPath);
                        return;
                    }
                }
                ctx.body = show_dir(toOpen);
            } else {
                // FIX #2: Set 404 status when directory listing is disabled
                ctx.status = 404;
                ctx.body = requestedUrlNotFound();
            }
            return;
        } else {
            // Handle file
            await loadFile(toOpen);
            return;
        }

        // Internal functions

        function requestedUrlNotFound() {
            return `
                <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta http-equiv="X-UA-Compatible" content="IE=edge">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>URL not found</title>
                    </head>
                    <body>
                    <h1>Not Found</h1>
                    <h3>The requested URL was not found on this server.</h3>
                    </body>
                    </html>
                `;
        }

        // FIX #3, #4, #5: Template error handling, race condition, file extension
        async function loadFile(toOpen) {
            // FIX #5: Proper file extension extraction using path.extname
            if (options.template.ext.length > 0 && options.template.render) {
                const fileExt = path.extname(toOpen).slice(1); // Remove leading dot

                if (fileExt && options.template.ext.includes(fileExt)) {
                    // FIX #3: Template rendering error handling
                    try {
                        await options.template.render(ctx, next, toOpen);
                        return;
                    } catch (error) {
                        console.error('Template rendering error:', error);
                        ctx.status = 500;
                        ctx.body = 'Internal Server Error - Template Rendering Failed';
                        return;
                    }
                }
            }

            // FIX #4: Race condition protection - verify file still exists and is readable
            try {
                await fs.promises.access(toOpen, fs.constants.R_OK);
            } catch (error) {
                console.error('File access error:', error);
                ctx.status = 404;
                ctx.body = requestedUrlNotFound();
                return;
            }

            // Serve static file
            let mimeType = mime.lookup(toOpen);
            const src = fs.createReadStream(toOpen);

            // Handle stream errors
            src.on('error', (err) => {
                console.error('Stream error:', err);
                if (!ctx.headerSent) {
                    ctx.status = 500;
                    ctx.body = 'Error reading file';
                }
            });

            ctx.response.set("content-type", mimeType);

            // FIX #7: Content-Disposition properly quoted with only basename
            const filename = path.basename(toOpen);
            const safeFilename = filename.replace(/"/g, '\\"'); // Escape quotes
            ctx.response.set(
                "content-disposition",
                `inline; filename="${safeFilename}"`
            );

            ctx.body = src;
        }

        // FIX #6: fs.readdirSync error handling
        function show_dir(toOpen) {
            let dir;
            try {
                dir = fs.readdirSync(toOpen, { withFileTypes: true });
            } catch (error) {
                console.error('Directory read error:', error);
                return `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Error</title>
                    </head>
                    <body>
                        <h1>Error Reading Directory</h1>
                        <p>Unable to access directory contents.</p>
                    </body>
                    </html>
                `;
            }

            let s_dir = "<table>";

            // Parent directory link
            if (pageHrefOutPrefix.origin + "/" != pageHrefOutPrefix.href) {
                const a_pD = pageHref.href.split("/");
                a_pD.pop();
                const parentDirectory = a_pD.join("/");
                // Escape HTML to prevent XSS
                s_dir += `<tr><td><a href="${escapeHtml(parentDirectory)}"><b>.. Parent Directory</b></a></td><td>DIR</td></tr>`;
            }

            if (dir.length == 0) {
                s_dir += `<tr><td>empty folder</td><td></td></tr>`;
                s_dir += `</table>`;
            } else {
                let a_sy = Object.getOwnPropertySymbols(dir[0]);
                const sy_type = a_sy[0];

                for (const item of dir) {
                    const s_name = item.name.toString();
                    const type = item[sy_type];

                    if (type == 1) {
                        // File
                        s_dir += `<tr><td> FILE `;
                    } else if (type == 2 || type == 3) {
                        // Directory or symbolic link
                        s_dir += `<tr><td>`;
                    } else {
                        console.error("Unknown file type:", type);
                        continue; // Skip unknown types instead of throwing
                    }

                    const itemPath = path.join(toOpen, s_name);
                    let itemUri = "";
                    if (pageHref.href == pageHref.origin + options.urlPrefix + "/") {
                        itemUri = `${pageHref.origin + options.urlPrefix}/${encodeURIComponent(s_name)}`;
                    } else {
                        itemUri = `${pageHref.href}/${encodeURIComponent(s_name)}`;
                    }

                    // Check if this is a reserved directory
                    if (pageHrefOutPrefix.pathname == '/' && options.urlsReserved.includes('/' + s_name) && (type == 2 || type == 3)) {
                        s_dir += ` ${escapeHtml(s_name)}</td> <td> DIR BUT RESERVED</td></tr>`;
                    } else {
                        // Escape HTML to prevent XSS in filenames
                        const mimeType = type == 2 ? "DIR" : (mime.lookup(itemPath) || 'unknown');
                        s_dir += ` <a href="${escapeHtml(itemUri)}">${escapeHtml(s_name)}</a> </td> <td> ${escapeHtml(mimeType)} </td></tr>`;
                    }
                }
            }

            s_dir += "</table>";

            let toReturn = `
                        <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta http-equiv="X-UA-Compatible" content="IE=edge">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Index of ${escapeHtml(pageHrefOutPrefix.pathname)}</title>
                    </head>
                    <body>
                    <h1>Index of ${escapeHtml(pageHrefOutPrefix.pathname)}</h1>`;

            toReturn += s_dir;

            toReturn += `
                    </body>
                    </html>
                `;
            return toReturn;
        }

        // Helper function to escape HTML and prevent XSS
        function escapeHtml(unsafe) {
            if (typeof unsafe !== 'string') {
                return unsafe;
            }
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
    };
};
