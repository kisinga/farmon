// CollapsibleSection Component - Generic collapsible wrapper
window.CollapsibleSection = {
    props: {
        title: { type: String, required: true },
        defaultOpen: { type: Boolean, default: false },
        badgeCount: { type: Number, default: null },
        badgeText: { type: String, default: null }
    },
    template: `
        <div class="collapse collapse-arrow bg-base-100 shadow-xl rounded-box collapse-section">
            <input type="checkbox" :checked="defaultOpen" />
            <div class="collapse-title font-medium flex items-center gap-2">
                {{ title }}
                <span v-if="badgeCount !== null" class="badge badge-sm badge-ghost">{{ badgeCount }}</span>
                <span v-else-if="badgeText" class="badge badge-sm badge-ghost">{{ badgeText }}</span>
            </div>
            <div class="collapse-content overflow-hidden">
                <slot></slot>
            </div>
        </div>
    `
};
