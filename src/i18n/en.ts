export const en = {
  // Auth screen
  auth: {
    welcome: 'Welcome',
    createProfile: 'Create a profile to get started',
    signIn: 'Sign in',
    newProfile: 'New profile',
    name: 'Name',
    email: 'Email (optional)',
    role: 'Role',
    startWorking: 'Start working →',
    enter: 'Enter →',
    profile: 'Profile',
    features: {
      providers: '10+ AI providers in one window',
      memory: 'Memory across sessions',
      agents: 'Parallel agents',
    },
    detected: 'Detected on your computer:',
    tagline: 'AI assistant for development',
    creatingProfile: 'Creating profile…',
    enteringProfile: 'Signing in…',
    nameHint: 'What is your name?',
    emailHint: 'for future cloud sync',
  },

  // Sidebar
  sidebar: {
    chat: 'Chat',
    tasks: 'Tasks',
    journal: 'Journal',
    plan: 'Plan',
    skills: 'Skills',
    browser: 'Browser',
    design: 'Design',
    video: 'Video',
    feedback: 'Feedback',
    files: 'Files',
    mainChat: 'Main chat',
    project: 'Project',
    openFolder: 'Open folder',
    deleteChat: 'Delete this chat and all its messages?',
    collapse: 'Collapse',
    expand: 'Expand',
    newChat: 'New chat',
    delete: 'Delete',
  },

  // Settings
  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    profiles: 'Profiles',
    providers: 'Providers',
    models: 'Models',
    connectors: 'Connectors',
    nightMode: 'Night mode',
    memory: 'Memory',
    language: 'Language',
    costCap: 'Cost cap (auto-stop)',
    costCapLabel: 'Limit $/session',
    apiKeyNotSet: 'API key not set — click to open Settings',
    settingsAndKeys: '⚙ Settings and keys…',
    save: 'Save',
    saved: 'Saved ✓',
    coreMemory: 'Core Memory',
    coreMemoryHint: '(always in agent context)',
    aboutProject: 'About project (MEMORY.md)',
    aboutUser: 'About user (USER.md)',
    archivalMemory: 'Archival Memory',
    noMemories: 'No saved memories for this project',
    clearAll: 'Clear all',
    detectedCli: 'Detected CLI tools',
    application: 'Application',
    server: 'Server',
    resizeDrag: 'Drag to resize',
  },

  // Model picker
  modelPicker: {
    changeModel: 'Change model / provider',
    provider: 'Provider',
    model: 'Model',
    hidden: 'hidden',
    allModelsOff: 'All models disabled',
    enableIn: 'enable in Settings → Models',
  },

  // Chat
  chat: {
    placeholder: 'Describe a task. Enter — send, Shift+Enter — new line, Ctrl+V — paste screenshot.',
    streamingPlaceholder: 'is responding… (Esc — stop)',
    codeReview: 'Code Review',
    gitSummary: 'Git Summary',
    explainCode: 'Explain Code',
    whatToImprove: 'What to improve in the project?',
  },

  // Effort control
  effort: {
    quick: 'Quick — short answers',
    standard: 'Standard',
    deep: 'Deep — extended thinking',
  },

  // Placeholder views
  views: {
    skillsTitle: 'Skills',
    skillsDesc: 'AI skills extend agent capabilities. Create .md files in .verstak/skills/ or connect a skills server.',
    skillsOpenFolder: 'Open skills folder',
    skillsSetupServer: 'Setup server',
    designTitle: 'Design Studio',
    designDesc: 'AI design: layouts, UI components, landing pages, presentations. Describe what you need — the agent creates an interactive prototype.',
    designHint: 'Supports: HTML/CSS export, 150+ design systems, responsive layouts',
    designCreate: 'Create a layout',
    videoTitle: 'Video Studio',
    videoDesc: 'AI video, image, animation generation. Describe a scene — the agent creates video through connected models.',
    videoHint: 'Models: Veo, Kling, Seedance, Flux, Midjourney (via API keys)',
    videoCreate: 'Create video',
    terminal: 'Terminal',
    hide: 'Hide',
  },

  // Connectors
  connectors: {
    connected: 'Connected',
    add: 'Add',
  },

  // Common
  common: {
    close: 'Close',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    search: 'Search',
    loading: 'Loading...',
    error: 'Error',
    ok: 'OK',
  },
}

export type Translations = typeof en
