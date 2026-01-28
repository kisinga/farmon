// HistoryView Component - History tab content
export default {
    props: {
        deviceEui: { type: String, required: true }
    },
    template: `
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body p-3">
                <h2 class="card-title text-sm sm:text-base mb-3">Command & State History</h2>
                <p class="text-xs opacity-60 mb-3">View all commands sent to the device and state changes that have occurred.</p>
                
                <command-history :device-eui="deviceEui" />
            </div>
        </div>
    `
};
