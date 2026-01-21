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
            password: "$2b$08$05Wbo0WcTtVvh6XB8F6ZZuCew61HfUEUz2cmdkqmtmg3p58kS8lCu",
            permissions: "*"
        }]
    },

    // HTTP node settings
    httpAdminRoot: '/',
    httpNodeRoot: '/api',

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
