// CollapsibleSection Component - Generic collapsible wrapper
// Using custom toggle instead of DaisyUI collapse for better chart rendering
window.CollapsibleSection = {
    props: {
        title: { type: String, required: true },
        defaultOpen: { type: Boolean, default: false },
        badgeCount: { type: Number, default: null },
        badgeText: { type: String, default: null }
    },
    data() {
        return {
            isOpen: this.defaultOpen
        };
    },
    template: `
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body p-0">
                <div class="flex items-center justify-between cursor-pointer p-3 hover:bg-base-200 rounded-t-box"
                     @click="isOpen = !isOpen">
                    <div class="flex items-center gap-2 font-medium">
                        {{ title }}
                        <span v-if="badgeCount !== null" class="badge badge-sm badge-ghost">{{ badgeCount }}</span>
                        <span v-else-if="badgeText" class="badge badge-sm badge-ghost">{{ badgeText }}</span>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg"
                         class="h-5 w-5 transition-transform duration-200"
                         :class="{ 'rotate-180': isOpen }"
                         fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
                <div v-show="isOpen" class="px-3 pb-3">
                    <slot></slot>
                </div>
            </div>
        </div>
    `
};
