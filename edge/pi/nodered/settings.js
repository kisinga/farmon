/**
 * Node-RED Settings for Farm Monitoring
 * 
 * This file is mounted into the container at /data/settings.js
 * See: https://nodered.org/docs/user-guide/runtime/configuration
 */

module.exports = {
    // Flow file location
    flowFile: 'flows.json',
    
    // Flow file pretty-printed
    flowFilePretty: true,

    // Admin UI settings
    adminAuth: {
        type: "credentials",
        users: [{
            username: "admin",
            // Default password: "farmmon" - change in production!
            // Generate new hash: node -e "console.log(require('bcryptjs').hashSync('yourpassword', 8));"
            password: "$2a$08$zZWtXTja0fB1pzD4sHCMyOCMYz2Z6dNbM6tl8sJogENOMcxWV9DN.",
            permissions: "*"
        }]
    },

    // HTTP node settings
    httpAdminRoot: '/',
    httpNodeRoot: '/api',
    
    // Dashboard UI will be at /ui
    ui: { path: "ui" },

    // Logging
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },

    // Context storage (for persistent variables)
    contextStorage: {
        default: {
            module: "localfilesystem"
        }
    },

    // Editor settings
    editorTheme: {
        projects: {
            enabled: false
        },
        header: {
            title: "Farm Monitor"
        }
    },

    // Function node settings
    functionGlobalContext: {
        // Add any global modules here
    },

    // Disable tour for new users
    tours: false
};
