document.addEventListener('DOMContentLoaded', () => {

    const DEFAULT_AI_PROMPT_TEMPLATE = `Compare these two security controls and identify any GAPS in Control Library relative to Custom Controls. \n\nCustom Controls: "{{customText}}"\nControl Library: "{{controlLibraryText}}"\n\nResponse should be a concise summary of missing elements in Control Library. If no significant gaps, say "No significant gaps detected."`;
    const DEFAULT_AI_GROUP_PROMPT_TEMPLATE = `You are a security compliance expert. Compare multiple security controls (Control Library) against one control (Custom Controls). Identify if the COMBINED set of Control Library controls covers all elements of Custom Controls. If there are still GAPS, identify them concisely.\n\nCustom Controls: "{{customText}}"\nControl Library:\n{{controlLibraryList}}\n\nResponse should be a concise summary of missing elements in the combined set. If no significant gaps, say "No significant gaps detected."`;

    // State management
    const state = {
        drata: {
            data: null,
            columns: [],
            selectedColumn: null, // Description column
            idColumn: null,       // Specific ID column
            filename: null
        },
        custom: {
            data: null,
            columns: [],
            idColumn: null,
            selectedColumn: null,
            filename: null
        },
        mappings: {}, // format: { customControlId: [drataControlId1, drataControlId2, ...] }
        comments: {}, // format: { customControlId: { drataControlId: commentText } }
        groupComments: {}, // format: { customControlId: groupedCommentText }
        threshold: 60,
        topX: 5,
        sortBy: 'semantic', // 'semantic' or 'keyword'
        stopwords: ['a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'from', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing'],
        activeTab: 'readme',
        columnWidths: {}, // format: { classIdentifier: widthInPx }
        aiEnabled: true,
        modelSource: 'github',
        customHost: '',
        weightSemantic: 50, // 0-100, percentage for semantic weight
        embeddings: {
            drata: new Map(), // drataText -> embedding
            custom: new Map() // customText -> embedding
        },
        drataTokens: new Map(), // drataText -> Set of tokens
        gapAnalysisEnabled: false,
        geminiApiKey: '',
        aiProvider: 'gemini',
        aiBaseUrl: '',
        aiModel: 'gemini-1.5-flash',
        aiPromptTemplate: DEFAULT_AI_PROMPT_TEMPLATE,
        aiGroupPromptTemplate: DEFAULT_AI_GROUP_PROMPT_TEMPLATE,
        autoLoadModel: true
    };

    const modelStatus = document.getElementById('model-status');
    const mappingProgress = document.createElement('div');
    mappingProgress.id = 'mapping-progress';
    mappingProgress.className = 'model-status';
    mappingProgress.style.display = 'none';
    mappingProgress.style.marginLeft = '10px';

    let semanticPipeline = null;
    let pipelinePromise = null;
    let isPipelineLoading = false;

    async function initSemanticPipeline() {
        if (semanticPipeline) return; // Already loaded
        if (pipelinePromise) return pipelinePromise; // Wait for existing load

        pipelinePromise = (async () => {
            const headerStatus = document.getElementById('header-ai-status');
            const headerStatusText = headerStatus ? headerStatus.querySelector('.status-text') : null;

            if (!window.transformers) {
                console.error("Transformers.js not found. Check your internet connection.");
                if (modelStatus) {
                    modelStatus.style.display = 'flex';
                    modelStatus.innerHTML = '<span style="color:#ef4444">Library missing (Transformers.js). Please refresh.</span>';
                }
                pipelinePromise = null;
                return;
            }

            const isLocalProtocol = window.location.protocol === 'file:';
            const env = window.transformers.env;

            if (state.modelSource === 'local') {
                if (isLocalProtocol) {
                    console.error("Local model loading is blocked by browser security (file://). Please use a local server.");
                    if (modelStatus) {
                        modelStatus.style.display = 'flex';
                        modelStatus.innerHTML = '<span style="color:#ef4444">Browser security blocks local files (file://). Please use a web server (e.g. Live Server).</span>';
                    }
                    pipelinePromise = null;
                    return;
                }

                env.remoteHost = window.location.origin + window.location.pathname.split('/').slice(0, -1).join('/') + '/';
                env.remotePathTemplate = 'models/{model}/';
            } else if (state.modelSource === 'github') {
                env.allowLocalModels = false;
                env.allowRemoteModels = true;
                env.remoteHost = 'https://raw.githubusercontent.com/ziamz/ControlMapper/main/';
                env.remotePathTemplate = 'models/{model}/';
            } else {
                env.allowLocalModels = false;
                env.allowRemoteModels = true;
                env.remoteHost = state.modelSource === 'custom' ? state.customHost : state.modelSource;
                env.remotePathTemplate = '{model}/resolve/{revision}/';
            }

            isPipelineLoading = true;
            if (downloadAiBtn) {
                downloadAiBtn.disabled = true;
                downloadAiBtn.innerHTML = '⏳ Initializing...';
            }

            if (modelStatus) {
                modelStatus.style.display = 'flex';
                modelStatus.style.opacity = '1';
                modelStatus.innerHTML = '<span class="spinner"></span> Connecting to Model Source...';
            }

            if (headerStatus) {
                headerStatus.style.display = 'flex';
                if (headerStatusText) headerStatusText.textContent = 'Starting AI...';
            }

            console.log(`Loading AI Model from ${state.modelSource === 'local' ? './models/' : env.remoteHost}...`);

            // Use a timeout to detect hangs (60 seconds)
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Connection Timed Out (60s)')), 60000);
            });

            try {
                const loadPromise = window.transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                    progress_callback: (data) => {
                        const progress = data.status === 'progress' ? Math.round(data.progress) : 0;
                        if (data.status === 'progress' && modelStatus) {
                            modelStatus.innerHTML = `<span class="spinner"></span> Downloading AI Model: ${progress}%`;
                        } else if (data.status === 'download' && modelStatus) {
                            modelStatus.innerHTML = `<span class="spinner"></span> Downloading: ${data.file}...`;
                        }

                        if (headerStatusText) {
                            headerStatusText.textContent = progress > 0 ? `AI Loading: ${progress}%` : 'AI Loading...';
                        }
                    }
                });

                semanticPipeline = await Promise.race([loadPromise, timeoutPromise]);

                console.log("AI Semantic Model Loaded Successfully.");
                if (modelStatus) {
                    modelStatus.innerHTML = '✨ AI Semantic Matching Active';
                    setTimeout(() => {
                        modelStatus.style.opacity = '0';
                        setTimeout(() => modelStatus.style.display = 'none', 500);
                    }, 3000);
                }

                if (headerStatus) {
                    if (headerStatusText) headerStatusText.textContent = 'AI Ready';
                    setTimeout(() => {
                        headerStatus.style.opacity = '0';
                        setTimeout(() => {
                            headerStatus.style.display = 'none';
                            headerStatus.style.opacity = '1';
                        }, 500);
                    }, 3000);
                }
            } catch (error) {
                console.error("Failed to load AI Semantic Model:", error);
                state.aiEnabled = false;
                if (aiToggle) aiToggle.checked = false;
                if (modelStatus) {
                    const isTimeout = error.message.includes('Timed Out');
                    const suggestMirror = state.modelSource.includes('huggingface.co');
                    modelStatus.innerHTML = `<div style="color:#ef4444; display: flex; flex-direction: column; gap: 0.25rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        <span>${isTimeout ? 'Request Timed Out.' : 'Connection Failed.'}</span>
                        <a href="#" onclick="retryAiLoad(); return false;" style="color: var(--primary); text-decoration: underline;">Retry?</a>
                    </div>
                    ${suggestMirror ? '<small style="color: var(--text-muted); opacity: 0.8;">Company network blocking HF? Try <strong>HF Mirror</strong> in Settings.</small>' : ''}
                </div>`;
                }

                if (headerStatus) headerStatus.style.display = 'none';

                pipelinePromise = null; // Clear so it can be retried
            } finally {
                isPipelineLoading = false;
                if (downloadAiBtn) {
                    downloadAiBtn.disabled = false;
                    downloadAiBtn.innerHTML = '📥 Initialize / Re-download AI Model';
                }
            }
        })();

        return pipelinePromise;
    }

    async function getEmbedding(text, type) {
        if (!text || !state.aiEnabled) return null;
        if (!semanticPipeline) await initSemanticPipeline();
        if (!semanticPipeline) return null;

        const cache = state.embeddings[type];
        if (cache.has(text)) return cache.get(text);

        try {
            const output = await semanticPipeline(text, { pooling: 'mean', normalize: true });
            const embedding = Array.from(output.data);
            cache.set(text, embedding);
            // console.log(`Generated embedding for: "${text.substring(0, 30)}..." (Length: ${embedding.length})`);
            return embedding;
        } catch (error) {
            console.error("Embedding error for:", text, error);
            return null;
        }
    }

    function cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB) return 0;
        let dotProduct = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
        }
        return Math.max(0, Math.min(1, dotProduct));
    }

    async function precalculateEmbeddings(texts, type) {
        if (!state.aiEnabled || !semanticPipeline) return;

        const uniqueTexts = [...new Set(texts)].filter(t => t && !state.embeddings[type].has(t));
        if (uniqueTexts.length === 0) {
            console.log(`All ${type} embeddings already cached.`);
            return;
        }

        console.log(`Pre-calculating ${uniqueTexts.length} embeddings for ${type}...`);

        // Process in small batches to avoid blocking the UI too long even during pre-calc
        const batchSize = 10;
        for (let i = 0; i < uniqueTexts.length; i += batchSize) {
            const batch = uniqueTexts.slice(i, i + batchSize);
            await Promise.all(batch.map(text => getEmbedding(text, type)));

            if (modelStatus) {
                const progress = Math.round(((i + batch.length) / uniqueTexts.length) * 100);
                modelStatus.innerHTML = `<span class="spinner"></span> AI Analysis: ${progress}%`;
                modelStatus.style.display = 'flex';
                modelStatus.style.opacity = '1';
            }
        }
    }

    function calculateScoresSync(customText, drataText) {
        // Keyword Score (Jaccard variant)
        const customTokens = new Set(tokenize(customText));

        if (!state.drataTokens.has(drataText)) {
            state.drataTokens.set(drataText, new Set(tokenize(drataText)));
        }
        const drataTokensSet = state.drataTokens.get(drataText);

        let matchCount = 0;
        customTokens.forEach(token => {
            if (drataTokensSet.has(token)) matchCount++;
        });

        const keywordScore = customTokens.size > 0
            ? (matchCount / Math.max(customTokens.size, drataTokensSet.size)) * 100
            : 0;

        // Semantic Score (using cached embeddings)
        let semanticScore = 0;
        if (state.aiEnabled) {
            const vecA = state.embeddings.custom.get(customText);
            const vecB = state.embeddings.drata.get(drataText);
            if (vecA && vecB) {
                semanticScore = cosineSimilarity(vecA, vecB) * 100;
            }
        }

        // Weighted Score
        const semanticWeight = state.weightSemantic / 100;
        const keywordWeight = 1 - semanticWeight;
        const weightedScore = (keywordScore * keywordWeight) + (semanticScore * semanticWeight);

        return { keyword: keywordScore, semantic: semanticScore, weighted: weightedScore };
    }

    // DOM Elements
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    const drataInput = document.getElementById('drata-file');
    const customInput = document.getElementById('custom-file');

    const drataStatus = document.getElementById('drata-status');
    const customStatus = document.getElementById('custom-status');

    const drataFilename = document.getElementById('drata-filename');
    const drataRowCount = document.getElementById('drata-row-count');
    const customFilename = document.getElementById('custom-filename');
    const customRowCount = document.getElementById('custom-row-count');

    const drataColContainer = document.getElementById('drata-column-container');
    const customColContainer = document.getElementById('custom-column-container');

    const drataSelect = document.getElementById('drata-column');
    const drataIdSelect = document.getElementById('drata-id-column');
    const customSelect = document.getElementById('custom-column');
    const customIdSelect = document.getElementById('custom-id-column');

    // DOM Elements - Mapping UI
    const topXInput = document.getElementById('top-x-input');
    const sortBySelect = document.getElementById('sort-by-select');

    // DOM Elements - Settings
    const stopwordsArea = document.getElementById('stopwords-area');
    const saveSettingsBtn = document.getElementById('save-settings-btn');

    // DOM Elements - Mapping Table
    const mappingBody = document.getElementById('mapping-body');

    const summarySection = document.getElementById('comparison-summary');
    const refreshMappingBtn = document.getElementById('refresh-mapping-btn');
    const drataPreview = document.getElementById('drata-col-preview');
    const customPreview = document.getElementById('custom-col-preview');

    const exportBtn = document.getElementById('download-results-btn');
    const aiToggle = document.getElementById('ai-toggle');
    const downloadAiBtn = document.getElementById('download-ai-btn');
    const modelSourceSelect = document.getElementById('model-source-select');
    const customHostUrl = document.getElementById('custom-host-url');
    const customHostContainer = document.getElementById('custom-host-container');

    const mappingWeightSlider = document.getElementById('mapping-weight-slider');
    const weightDisplay = document.getElementById('weight-value-display');

    // Sheet Modal Elements
    const sheetModal = document.getElementById('sheet-modal');
    const sheetList = document.getElementById('sheet-list');
    const closeSheetModal = document.getElementById('close-sheet-modal');
    const confirmLoadBtn = document.getElementById('confirm-load-btn');
    const cancelLoadBtn = document.getElementById('cancel-load-btn');
    const headerRowInput = document.getElementById('header-row-input');
    const gapAnalysisToggle = document.getElementById('gap-analysis-toggle');
    const geminiApiKeyInput = document.getElementById('gemini-api-key');
    const aiProviderSelect = document.getElementById('ai-provider-select');
    const aiBaseUrlInput = document.getElementById('ai-base-url');
    const aiModelNameInput = document.getElementById('ai-model-name');
    const aiBaseUrlContainer = document.getElementById('ai-base-url-container');
    const bulkGapBtn = document.getElementById('bulk-gap-btn');
    const bulkLimitInput = document.getElementById('bulk-limit-input');
    const aiPromptTemplateInput = document.getElementById('ai-prompt-template');
    const aiGroupPromptTemplateInput = document.getElementById('ai-group-prompt-template');
    const autoLoadToggle = document.getElementById('auto-load-toggle');

    // Toggle Retry logic
    window.retryAiLoad = () => {
        state.aiEnabled = true;
        if (aiToggle) aiToggle.checked = true;
        initSemanticPipeline();
    };

    // NLP Utils
    function tokenize(text) {
        if (!text) return [];
        const stopSet = new Set(state.stopwords);
        return String(text).toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 1 && !stopSet.has(word));
    }

    async function calculateScores(text1, text2, type1 = 'custom', type2 = 'drata') {
        const results = { keyword: 0, semantic: 0 };
        if (!text1 || !text2) return results;

        // Keyword Match (Overlap Coefficient)
        const tokens1 = Array.from(new Set(tokenize(text1)));
        const tokens2 = Array.from(new Set(tokenize(text2)));

        if (tokens1.length > 0 && tokens2.length > 0) {
            const set2 = new Set(tokens2);
            const intersection = tokens1.filter(x => set2.has(x));
            results.keyword = (intersection.length / Math.min(tokens1.length, tokens2.length)) * 100;
        }

        // Semantic Match (AI Embeddings)
        if (state.aiEnabled) {
            const emb1 = await getEmbedding(text1, type1);
            const emb2 = await getEmbedding(text2, type2);

            if (emb1 && emb2) {
                results.semantic = cosineSimilarity(emb1, emb2) * 100;
            }
        }

        return results;
    }

    function getColumnValue(obj, columnName) {
        if (!obj || !columnName) return null;

        // 1. Direct match (most efficient)
        if (obj[columnName] !== undefined && obj[columnName] !== null) return obj[columnName];

        // 2. Case-insensitive and trimmed match
        const lowerName = String(columnName).toLowerCase().trim();
        const keys = Object.keys(obj);
        for (const k of keys) {
            if (String(k).toLowerCase().trim() === lowerName) {
                return obj[k];
            }
        }

        // 3. Partial match as a last resort (e.g. "ID (Required)" matches "ID")
        for (const k of keys) {
            const lowerK = String(k).toLowerCase().trim();
            if (lowerK.includes(lowerName) || lowerName.includes(lowerK)) {
                return obj[k];
            }
        }

        return null;
    }

    function findBestId(obj) {
        if (!obj) return null;
        const idTerms = ['id', 'reference', 'ref', 'code', 'number', 'ctrl', 'control id'];
        const keys = Object.keys(obj);
        for (const term of idTerms) {
            const match = keys.find(k => k.toLowerCase().includes(term));
            if (match && obj[match] !== undefined && obj[match] !== null) return obj[match];
        }
        return null;
    }

    // Initialize from LocalStorage
    try {
        loadState();
    } catch (error) {
        console.error("Initialization Failed:", error);
    }

    // Tab Logic
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
            if (tabName === 'mapping') renderMappingTable();
            if (tabName === 'settings') renderSettings();
        });
    });

    function switchTab(tabName) {
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        tabContents.forEach(c => c.classList.toggle('active', c.id === tabName));
        state.activeTab = tabName;
        saveState();
    }

    // Settings Logic

    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            if (stopwordsArea) {
                state.stopwords = stopwordsArea.value.split('\n').map(s => s.trim().toLowerCase()).filter(s => s);
                saveState();
                alert('Settings saved!');
            }
        });
    }

    function renderSettings() {
        if (stopwordsArea) stopwordsArea.value = state.stopwords.join('\n');
        if (aiToggle) aiToggle.checked = state.aiEnabled;
        if (modelSourceSelect) modelSourceSelect.value = state.modelSource;
        if (customHostUrl) customHostUrl.value = state.customHost;
        if (customHostContainer) {
            customHostContainer.style.display = state.modelSource === 'custom' ? 'flex' : 'none';
        }
        if (topXInput) topXInput.value = state.topX || 5;
        if (sortBySelect) sortBySelect.value = state.sortBy || 'semantic';
    }

    if (modelSourceSelect) {
        modelSourceSelect.addEventListener('change', (e) => {
            state.modelSource = e.target.value;
            renderSettings();
            saveState();
        });
    }

    if (customHostUrl) {
        customHostUrl.addEventListener('input', (e) => {
            state.customHost = e.target.value;
            saveState();
        });
    }

    if (aiToggle) {
        aiToggle.addEventListener('change', (e) => {
            state.aiEnabled = e.target.checked;
            saveState();
            if (state.aiEnabled && !semanticPipeline) {
                initSemanticPipeline();
            }
        });
    }

    if (gapAnalysisToggle) {
        gapAnalysisToggle.addEventListener('change', (e) => {
            state.gapAnalysisEnabled = e.target.checked;
            saveState();
        });
    }

    if (geminiApiKeyInput) {
        geminiApiKeyInput.addEventListener('input', (e) => {
            state.geminiApiKey = e.target.value;
            saveState();
        });
    }

    if (aiProviderSelect) {
        aiProviderSelect.addEventListener('change', (e) => {
            state.aiProvider = e.target.value;
            if (aiBaseUrlContainer) {
                aiBaseUrlContainer.style.display = state.aiProvider === 'openai' ? 'flex' : 'none';
            }
            // Update default model if needed
            if (!state.aiModel || state.aiModel === 'gemini-1.5-flash' || state.aiModel === 'gpt-4o') {
                state.aiModel = state.aiProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o';
                if (aiModelNameInput) aiModelNameInput.value = state.aiModel;
            }
            saveState();
        });
    }

    if (aiBaseUrlInput) {
        aiBaseUrlInput.addEventListener('input', (e) => {
            state.aiBaseUrl = e.target.value;
            saveState();
        });
    }

    if (aiModelNameInput) {
        aiModelNameInput.addEventListener('input', (e) => {
            state.aiModel = e.target.value;
            saveState();
        });
    }

    if (aiPromptTemplateInput) {
        aiPromptTemplateInput.addEventListener('input', (e) => {
            state.aiPromptTemplate = e.target.value;
            saveState();
        });
    }

    if (aiGroupPromptTemplateInput) {
        aiGroupPromptTemplateInput.addEventListener('input', (e) => {
            state.aiGroupPromptTemplate = e.target.value;
            saveState();
        });
    }

    if (autoLoadToggle) {
        autoLoadToggle.addEventListener('change', (e) => {
            state.autoLoadModel = e.target.checked;
            saveState();
        });
    }

    if (downloadAiBtn) {
        downloadAiBtn.addEventListener('click', () => {
            console.log("Manual AI Initialization Triggered...");
            state.aiEnabled = true;
            if (aiToggle) aiToggle.checked = true;
            semanticPipeline = null;
            isPipelineLoading = false;
            initSemanticPipeline();
        });
    }

    // Mapping Table Logic
    if (topXInput) {
        topXInput.addEventListener('change', (e) => {
            state.topX = parseInt(e.target.value) || 5;
            saveState();
        });
    }

    if (sortBySelect) {
        sortBySelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            saveState();
        });
    }

    if (mappingWeightSlider) {
        mappingWeightSlider.addEventListener('input', (e) => {
            state.weightSemantic = parseInt(e.target.value);
            if (weightDisplay) weightDisplay.textContent = state.weightSemantic;
            // No saveState here to avoid too many writes, only on change or explicit save
        });

        mappingWeightSlider.addEventListener('change', () => {
            saveState();
            renderMappingTable(); // Re-render to show updated weighted scores
        });
    }

    if (refreshMappingBtn) {
        refreshMappingBtn.addEventListener('click', () => {
            // Show loading state first
            if (mappingBody) mappingBody.innerHTML = '<tr><td colspan="7" class="empty-state">Recalculating suggestions...</td></tr>';

            // Use timeout to allow UI to render loading state
            setTimeout(() => {
                renderMappingTable();
            }, 50);
        });
    }

    if (bulkGapBtn) {
        bulkGapBtn.addEventListener('click', () => {
            if (!state.gapAnalysisEnabled || !state.geminiApiKey) {
                alert('Please enable AI Gap Analysis and provide an API Key in Settings first.');
                return;
            }
            if (!state.custom.data || !state.drata.data) {
                alert('No data loaded. Use Upload tab first.');
                return;
            }
            runBulkGapAnalysis();
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (!state.custom.data || !state.drata.data) {
                alert('No data to export!');
                return;
            }
            exportToExcel();
        });
    }

    async function exportToExcel() {
        console.log("exportToExcel function called");
        if (!state.custom.data || !state.drata.data) {
            console.warn("Export failed: Custom Controls or Control Library data is missing", { customData: !!state.custom.data, drataData: !!state.drata.data });
            return;
        }

        console.log("Starting semantic export with data...", {
            customCount: state.custom.data.length,
            drataCount: state.drata.data.length
        });

        // Show loading state or block UI
        exportBtn.innerHTML = '⏳ Processing...';
        exportBtn.disabled = true;

        try {
            // 1. Ensure all embeddings are cached
            if (state.aiEnabled) {
                console.log("Ensuring AI embeddings are cached...");
                await initSemanticPipeline(); // Ensure model is loaded

                const customTexts = state.custom.data.map(c => getColumnValue(c, state.custom.selectedColumn) || '');
                await precalculateEmbeddings(customTexts, 'custom');

                const drataTexts = state.drata.data.map(d => getColumnValue(d, state.drata.selectedColumn) || '');
                await precalculateEmbeddings(drataTexts, 'drata');
            }

            const exportData = [];

            // Processing in batches to keep UI responsive even during export
            const total = state.custom.data.length;
            const batchSize = 20;

            for (let i = 0; i < total; i += batchSize) {
                const end = Math.min(i + batchSize, total);
                for (let cIdx = i; cIdx < end; cIdx++) {
                    const customControl = state.custom.data[cIdx];
                    const customText = getColumnValue(customControl, state.custom.selectedColumn) || '';
                    const customIdRaw = getColumnValue(customControl, state.custom.idColumn);
                    const customId = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : `C-${cIdx + 1}`;
                    const mapKey = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : customText;

                    // Find current mappings
                    const mappedDrataIds = state.mappings[mapKey] || [];
                    const groupComment = state.groupComments[mapKey] || '';

                    let matches = state.drata.data.map((drataControl) => {
                        const drataText = getColumnValue(drataControl, state.drata.selectedColumn) || '';
                        const scores = calculateScoresSync(customText, drataText);
                        return { control: drataControl, ...scores };
                    })
                        .sort((a, b) => b[state.sortBy] - a[state.sortBy])
                        .slice(0, state.topX);

                    // Ensure ALL mapped controls are in the exported list even if not in topX
                    mappedDrataIds.forEach(mId => {
                        const isAlreadyInMatches = matches.some(match => {
                            let rawId = getColumnValue(match.control, state.drata.idColumn) || findBestId(match.control);
                            const currentDrataId = rawId ? String(rawId) : (getColumnValue(match.control, state.drata.selectedColumn) || '');
                            return currentDrataId === mId;
                        });

                        if (!isAlreadyInMatches) {
                            const mappedControl = state.drata.data.find(d => {
                                let rawId = getColumnValue(d, state.drata.idColumn) || findBestId(d);
                                const currentDrataId = rawId ? String(rawId) : (getColumnValue(d, state.drata.selectedColumn) || '');
                                return currentDrataId === mId;
                            });

                            if (mappedControl) {
                                const drataText = getColumnValue(mappedControl, state.drata.selectedColumn) || '';
                                const scores = calculateScoresSync(customText, drataText);
                                matches.push({ control: mappedControl, ...scores, forceInclude: true });
                            }
                        }
                    });

                    if (matches.length === 0) {
                        const exportText = (customIdRaw !== null && customIdRaw !== undefined && String(customIdRaw).trim() !== '') ? (customId !== customText ? `${customId}: ${customText}` : customId) : `${cIdx + 1}: ${customText}`;

                        exportData.push({
                            '#': cIdx + 1,
                            'Regulation / Custom Controls': exportText,
                            'Keyword %': '',
                            'Semantics %': '',
                            'Weighted Avg %': '',
                            'ID': '',
                            'Control Library Text': '',
                            'Trigger LLM Analysis': '',
                            'LLM Gap Analysis': '',
                            'Mapped?': '',
                            'Grouped Analysis': groupComment
                        });
                    } else {
                        matches.forEach((match, mIdx) => {
                            const drataValue = getColumnValue(match.control, state.drata.selectedColumn) || '';
                            let rawId = getColumnValue(match.control, state.drata.idColumn) || findBestId(match.control);
                            const drataIdDisplay = rawId ? String(rawId) : 'N/A';
                            const currentDrataId = rawId ? String(rawId) : drataValue;

                            const isMapped = mappedDrataIds.includes(currentDrataId);
                            const commentKey = `${mapKey}-${currentDrataId}`;
                            const savedComment = state.comments[commentKey] || '';

                            const exportText = (customIdRaw !== null && customIdRaw !== undefined && String(customIdRaw).trim() !== '') ? (customId !== customText ? `${customId}: ${customText}` : customId) : `${cIdx + 1}: ${customText}`;

                            exportData.push({
                                '#': mIdx === 0 ? cIdx + 1 : (match.forceInclude ? '*' : ''),
                                'Regulation / Custom Controls': mIdx === 0 ? exportText : '',
                                'Keyword %': Math.round(match.keyword) + '%',
                                'Semantics %': Math.round(match.semantic) + '%',
                                'Weighted Avg %': Math.round(match.weighted) + '%',
                                'ID': drataIdDisplay,
                                'Control Library Text': drataValue,
                                'Trigger LLM Analysis': '', // Removed mapped indicator from here
                                'LLM Gap Analysis': savedComment,
                                'Mapped?': isMapped ? 'Y' : '',
                                'Grouped Analysis': mIdx === 0 ? groupComment : ''
                            });
                        });
                    }
                }
                // Yield to browser
                if (modelStatus) {
                    modelStatus.innerHTML = `<span class="spinner"></span> Exporting: ${Math.round((end / total) * 100)}%`;
                    modelStatus.style.display = 'flex';
                    modelStatus.style.opacity = '1';
                }
                await new Promise(r => setTimeout(r, 0));
            }

            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Mapping Results');

            XLSX.writeFile(workbook, `ControlMapper_Export_${new Date().toISOString().split('T')[0]}.xlsx`);

            exportBtn.innerHTML = '📊 Export results to Excel';
            exportBtn.disabled = false;

            if (modelStatus) {
                modelStatus.innerHTML = '✨ Export Complete';
                setTimeout(() => {
                    modelStatus.style.opacity = '0';
                    setTimeout(() => modelStatus.style.display = 'none', 500);
                }, 2000);
            }
        } catch (error) {
            console.error("Export error:", error);
            alert("Export failed: " + error.message);
        } finally {
            exportBtn.innerHTML = '📊 Export results to Excel';
            exportBtn.disabled = false;
        }
    }

    async function renderMappingTable() {
        if (!state.custom.data || !state.drata.data) {
            mappingBody.innerHTML = '<tr><td colspan="8" class="empty-state">No data loaded. Use Upload tab first.</td></tr>';
            return;
        }

        const container = document.querySelector('.mapping-actions');
        if (container && !document.getElementById('mapping-progress')) {
            container.appendChild(mappingProgress);
        }

        // 1. Pre-calculate Custom Embeddings
        if (state.aiEnabled) {
            await initSemanticPipeline(); // Ensure model is loaded

            const customTexts = state.custom.data.map(c => getColumnValue(c, state.custom.selectedColumn) || '');
            await precalculateEmbeddings(customTexts, 'custom');

            const drataTexts = state.drata.data.map(d => getColumnValue(d, state.drata.selectedColumn) || '');
            await precalculateEmbeddings(drataTexts, 'drata');
        }

        mappingBody.innerHTML = '';
        const fragment = document.createDocumentFragment();

        mappingProgress.style.display = 'flex';
        mappingProgress.style.opacity = '1';
        mappingProgress.innerHTML = `<span class="spinner"></span> Mapping: 0%`;

        let currentIdx = 0;
        const total = state.custom.data.length;
        const batchSize = 10; // Process 10 custom rows at a time

        function processBatch() {
            const end = Math.min(currentIdx + batchSize, total);

            for (; currentIdx < end; currentIdx++) {
                try {
                    const cIdx = currentIdx;
                    const customControl = state.custom.data[cIdx];
                    const customText = getColumnValue(customControl, state.custom.selectedColumn) || '';
                    const customIdRaw = getColumnValue(customControl, state.custom.idColumn);
                    const customId = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : `C-${cIdx + 1}`;
                    const mapKey = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : customText;

                    // Sync Scoring using cache
                    const matches = state.drata.data.map(drataControl => {
                        const drataText = getColumnValue(drataControl, state.drata.selectedColumn) || '';
                        const scores = calculateScoresSync(customText, drataText);
                        return { control: drataControl, ...scores };
                    })
                        .sort((a, b) => b[state.sortBy] - a[state.sortBy])
                        .slice(0, state.topX);

                    if (matches.length === 0) {
                        const emptyRow = document.createElement('tr');
                        const hasCustomId = customIdRaw !== null && customIdRaw !== undefined && String(customIdRaw).trim() !== '';
                        const primaryText = hasCustomId ? customId : customText;
                        const secondaryText = hasCustomId ? (customId !== customText ? customText : '') : `C-${cIdx + 1}`;

                        emptyRow.innerHTML = `
                                <td>${cIdx + 1}</td>
                                <td class="col-regulation"><strong>${primaryText}</strong>${secondaryText ? `<br><small>${secondaryText}</small>` : ''}</td>
                                <td colspan="5" class="empty-state">No suggestions above threshold</td>
                                <td class="col-select"></td>
                                <td class="col-comments"></td>
                                <td class="col-mapped"></td>
                                <td class="col-group-analysis"></td>
                            `;
                        fragment.appendChild(emptyRow);
                    } else {
                        matches.forEach((match, mIdx) => {
                            const drataValue = getColumnValue(match.control, state.drata.selectedColumn) || '';
                            let rawId = getColumnValue(match.control, state.drata.idColumn) || findBestId(match.control);
                            const drataIdDisplay = rawId ? String(rawId) : 'N/A';
                            const drataMappedId = rawId ? String(rawId) : drataValue;

                            const mappedIds = state.mappings[mapKey] || [];
                            const isMapped = Array.isArray(mappedIds) ? mappedIds.includes(drataMappedId) : mappedIds === drataMappedId; // Safely handle both
                            const commentKey = `${mapKey}-${drataMappedId}`;
                            const savedComment = state.comments[commentKey] || '';
                            const hasComment = savedComment && !savedComment.startsWith('🤖') && !savedComment.startsWith('⚠️');
                            const isAnalyzing = savedComment === "🤖 AI Analyzing gaps...";

                            const row = document.createElement('tr');
                            row.className = `match-row ${isMapped ? 'mapped' : ''}`;

                            const hasCustomId = customIdRaw !== null && customIdRaw !== undefined && String(customIdRaw).trim() !== '';
                            const primaryText = hasCustomId ? customId : customText;
                            const secondaryText = hasCustomId ? (customId !== customText ? customText : '') : `C-${cIdx + 1}`;

                            // Group analysis state
                            const groupComment = state.groupComments[mapKey] || '';
                            const isGroupAnalyzing = groupComment === "🤖 AI Analyzing grouped controls...";

                            row.innerHTML = `
                                    <td>${mIdx === 0 ? cIdx + 1 : ''}</td>
                                    <td class="col-regulation">${mIdx === 0 ? `<strong>${primaryText}</strong>${secondaryText ? `<br><small>${secondaryText}</small>` : ''}` : ''}</td>
                                    <td class="col-score">${Math.round(match.keyword)}%</td>
                                    <td class="col-semantics">${Math.round(match.semantic)}%</td>
                                    <td class="col-weighted">${Math.round(match.weighted)}%</td>
                                    <td class="col-id"><strong>${drataIdDisplay}</strong></td>
                                    <td class="col-control">${drataValue}</td>
                                    <td class="col-select">
                                        <div class="action-cell">
                                            <button class="upload-btn select-match-btn ${isAnalyzing ? 'analyzing' : ''}" ${isAnalyzing ? 'disabled' : ''}>
                                                ${isAnalyzing ? 'Analyzing...' : (hasComment ? 'Regenerate' : 'Analyze')}
                                            </button>
                                        </div>
                                     </td>
                                     <td class="col-comments"><div class="comment-wrapper"><textarea placeholder="Add notes..." class="comment-area">${savedComment}</textarea></div></td>
                                     <td class="col-mapped">
                                         <div class="action-cell">
                                             <input type="checkbox" class="mapped-checkbox" ${isMapped ? 'checked' : ''}>
                                         </div>
                                     </td>
                                     <td class="col-group-analysis">
                                         ${mIdx === 0 ? `
                                         <div class="action-cell" style="flex-direction: column; gap: 5px; align-items: stretch; padding: 5px; height: 100%; box-sizing: border-box;">
                                             <button class="upload-btn group-analyze-btn ${isGroupAnalyzing ? 'analyzing' : ''}" ${isGroupAnalyzing ? 'disabled' : ''} style="width: 100%; flex-shrink: 0;">
                                                 ${isGroupAnalyzing ? 'Analyzing Group...' : (groupComment ? 'Regenerate Group' : 'Group Analyze')}
                                             </button>
                                             <div class="comment-wrapper" style="flex: 1; min-height: 0;">
                                                 <textarea placeholder="Group analysis result..." class="group-comment-area comment-area" style="font-size: 11px; min-height: 60px;">${groupComment}</textarea>
                                             </div>
                                         </div>
                                         ` : ''}
                                     </td>
                                 `;

                            row.querySelector('.select-match-btn').addEventListener('click', () => {
                                if (state.gapAnalysisEnabled && state.geminiApiKey) {
                                    const commentKey = `${mapKey}-${drataMappedId}`;
                                    state.comments[commentKey] = "🤖 AI Analyzing gaps...";
                                    runGapAnalysis(mapKey, drataMappedId, drataValue, customText);
                                    renderMappingTable();
                                } else {
                                    alert('Please enable AI Gap Analysis and provide an API Key in Settings first.');
                                }
                            });

                            row.querySelector('.comment-area').addEventListener('input', (e) => {
                                state.comments[commentKey] = e.target.value;
                                saveState();
                            });

                            row.querySelector('.mapped-checkbox').addEventListener('change', (e) => {
                                toggleMapping(mapKey, drataMappedId);
                                renderMappingTable();
                            });

                            if (mIdx === 0) {
                                row.querySelector('.group-analyze-btn').addEventListener('click', () => {
                                    if (state.gapAnalysisEnabled && state.geminiApiKey) {
                                        const mappedIds = state.mappings[mapKey] || [];
                                        runGroupGapAnalysis(mapKey, mappedIds, customText);
                                    } else {
                                        alert('Please enable AI Gap Analysis and provide an API Key in Settings first.');
                                    }
                                });

                                row.querySelector('.group-comment-area').addEventListener('input', (e) => {
                                    state.groupComments[mapKey] = e.target.value;
                                    saveState();
                                });
                            }

                            fragment.appendChild(row);
                        });
                    }
                } catch (e) {
                    console.error("Mapping row error:", e);
                }
            }

            mappingBody.appendChild(fragment);
            fragment.replaceChildren(); // Clear fragment for next batch

            const progress = Math.round((currentIdx / total) * 100);
            mappingProgress.innerHTML = `<span class="spinner"></span> Mapping: ${progress}%`;

            if (currentIdx < total) {
                setTimeout(processBatch, 0); // Schedule next batch
            } else {
                mappingProgress.innerHTML = '✨ Mapping Complete';
                setTimeout(() => {
                    mappingProgress.style.opacity = '0';
                    setTimeout(() => mappingProgress.style.display = 'none', 500);
                }, 2000);
            }
        }

        processBatch();
    }

    function toggleMapping(customId, drataId) {
        if (!state.mappings[customId]) {
            state.mappings[customId] = [];
        }

        const ids = state.mappings[customId];
        if (ids.includes(drataId)) {
            state.mappings[customId] = ids.filter(id => id !== drataId);
            if (state.mappings[customId].length === 0) {
                delete state.mappings[customId];
            }
        } else {
            ids.push(drataId);
        }
        saveState();
    }

    async function runBulkGapAnalysis() {
        if (!state.custom.data || !state.drata.data) return;

        const limit = parseInt(bulkLimitInput?.value) || 10;
        bulkGapBtn.disabled = true;
        bulkGapBtn.innerHTML = '⏳ Initializing...';

        const tasks = [];
        const maxControlsToProcess = Math.min(limit, state.custom.data.length);

        for (let cIdx = 0; cIdx < maxControlsToProcess; cIdx++) {
            const customControl = state.custom.data[cIdx];
            const customText = getColumnValue(customControl, state.custom.selectedColumn) || '';
            const customIdRaw = getColumnValue(customControl, state.custom.idColumn);
            const mapKey = (customIdRaw !== undefined && customIdRaw !== null && customIdRaw !== '') ? String(customIdRaw) : customText;

            // Find top suggestion
            const matches = state.drata.data.map(drataControl => {
                const drataText = getColumnValue(drataControl, state.drata.selectedColumn) || '';
                const scores = calculateScoresSync(customText, drataText);
                return { control: drataControl, ...scores };
            })
                .sort((a, b) => b[state.sortBy] - a[state.sortBy]);

            if (matches.length > 0) {
                const topMatch = matches[0];
                const drataValue = getColumnValue(topMatch.control, state.drata.selectedColumn) || '';
                let rawId = getColumnValue(topMatch.control, state.drata.idColumn) || findBestId(topMatch.control);
                const drataMappedId = rawId ? String(rawId) : drataValue;
                const commentKey = `${mapKey}-${drataMappedId}`;

                if (!state.comments[commentKey] || state.comments[commentKey].startsWith('⚠️') || state.comments[commentKey] === "🤖 AI Analyzing gaps...") {
                    tasks.push({
                        customId: mapKey,
                        drataId: drataMappedId,
                        drataText: drataValue,
                        customText: customText
                    });
                }
            }
        }

        if (tasks.length === 0) {
            alert(`No new rows to analyze in the top ${maxControlsToProcess} controls.`);
            bulkGapBtn.disabled = false;
            bulkGapBtn.innerHTML = '🤖 Bulk Analyze Gaps';
            return;
        }

        if (mappingProgress) {
            mappingProgress.style.display = 'flex';
            mappingProgress.style.opacity = '1';
            mappingProgress.innerHTML = `<span class="spinner"></span> Bulk Analysis: 0 / ${tasks.length}`;
        }

        const CONCURRENCY = 3;
        let completed = 0;
        const total = tasks.length;

        async function worker() {
            while (tasks.length > 0) {
                const task = tasks.shift();
                const commentKey = `${task.customId}-${task.drataId}`;
                state.comments[commentKey] = "🤖 AI Analyzing gaps...";

                // We don't call renderMappingTable for every single one to avoid UI lag
                // but we update the progress
                try {
                    await runGapAnalysis(task.customId, task.drataId, task.drataText, task.customText, false);
                } catch (e) {
                    console.error("Bulk Analysis Row Error:", e);
                }

                completed++;
                if (mappingProgress) {
                    mappingProgress.innerHTML = `<span class="spinner"></span> Bulk Analysis: ${completed} / ${total}`;
                }

                // Throttle a bit to avoid hitting rate limits too fast
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Start workers
        const workers = Array(Math.min(CONCURRENCY, tasks.length)).fill(null).map(worker);
        await Promise.all(workers);

        bulkGapBtn.disabled = false;
        bulkGapBtn.innerHTML = '🤖 Bulk Analyze Gaps';

        if (mappingProgress) {
            mappingProgress.innerHTML = '✨ Bulk Analysis Complete';
            setTimeout(() => {
                mappingProgress.style.opacity = '0';
                setTimeout(() => mappingProgress.style.display = 'none', 500);
            }, 2000);
        }


        renderMappingTable();
    }

        async function runGroupGapAnalysis(customId, drataIds, customText) {
            if (!drataIds || drataIds.length === 0) {
                alert('No Control Library controls selected for this group.');
                return;
            }

            try {
                state.groupComments[customId] = "🤖 AI Analyzing grouped controls...";
                renderMappingTable();

                // Collect all mapped drata control texts
                const drataTexts = drataIds.map(dId => {
                    const control = state.drata.data.find(d => {
                        let rawId = getColumnValue(d, state.drata.idColumn) || findBestId(d);
                        const currentDrataId = rawId ? String(rawId) : (getColumnValue(d, state.drata.selectedColumn) || '');
                        return currentDrataId === dId;
                    });
                    return control ? getColumnValue(control, state.drata.selectedColumn) : '';
                }).filter(t => t);

                const combinedDrataText = drataTexts.map((t, i) => `Control ${i + 1}: ${t}`).join('\n\n');

                const template = state.aiGroupPromptTemplate || DEFAULT_AI_GROUP_PROMPT_TEMPLATE;

                const prompt = template
                    .replace('{{customText}}', customText)
                    .replace('{{controlLibraryList}}', combinedDrataText);

                let result = '';
                if (state.aiProvider === 'gemini') {
                    const model = state.aiModel || 'gemini-1.5-flash';
                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.geminiApiKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }]
                        })
                    });

                    const data = await response.json();
                    if (data.candidates && data.candidates[0].content.parts[0].text) {
                        result = data.candidates[0].content.parts[0].text.trim();
                    }
                } else if (state.aiProvider === 'openai') {
                    const baseUrl = state.aiBaseUrl || 'https://api.openai.com/v1';
                    const model = state.aiModel || 'gpt-4o';
                    const response = await fetch(`${baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${state.geminiApiKey}`
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: [
                                { role: 'system', content: 'You are a security compliance expert specialized in control mapping.' },
                                { role: 'user', content: prompt }
                            ],
                            temperature: 0.2
                        })
                    });

                    const data = await response.json();
                    if (data.choices && data.choices[0].message.content) {
                        result = data.choices[0].message.content.trim();
                    }
                }

                if (result) {
                    state.groupComments[customId] = result;
                    saveState();
                    renderMappingTable();
                }
            } catch (error) {
                console.error("Group Gap Analysis Error:", error);
                state.groupComments[customId] = "⚠️ Analysis failed. Check API key or connection.";
                renderMappingTable();
            }
        }

    async function runGapAnalysis(customId, drataId, drataText, customText, triggerRender = true) {
        const commentKey = `${customId}-${drataId}`;

        try {
            // Use custom template if available, otherwise fallback to default
            const template = state.aiPromptTemplate || DEFAULT_AI_PROMPT_TEMPLATE;

            const prompt = template
                .replace(/{{customText}}/g, customText)
                .replace(/{{controlLibraryText}}/g, drataText);

            let result = '';
            if (state.aiProvider === 'gemini') {
                const model = state.aiModel || 'gemini-1.5-flash';
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.geminiApiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });

                const data = await response.json();
                if (data.candidates && data.candidates[0].content.parts[0].text) {
                    result = data.candidates[0].content.parts[0].text.trim();
                } else {
                    throw new Error("Invalid Gemini response");
                }
            } else if (state.aiProvider === 'openai') {
                const baseUrl = state.aiBaseUrl || 'https://api.openai.com/v1';
                const model = state.aiModel || 'gpt-4o';
                const response = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${state.geminiApiKey}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: 'system', content: 'You are a security compliance expert specialized in control mapping.' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.2
                    })
                });

                const data = await response.json();
                if (data.choices && data.choices[0].message.content) {
                    result = data.choices[0].message.content.trim();
                } else {
                    throw new Error("Invalid OpenAI response");
                }
            }

            if (result) {
                state.comments[commentKey] = result;
                saveState();
                renderMappingTable(); // Refresh table to show results
            }
        } catch (error) {
            console.error("Gap Analysis Error:", error);
            state.comments[commentKey] = "⚠️ Analysis failed. Check API key or connection.";
            renderMappingTable();
        }
    }

    // File Upload Handlers
    if (drataInput) {
        drataInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            console.log("[Event] Drata file input changed");
            if (file) handleFileUpload(file, 'drata');
            drataInput.value = ''; // Reset so the same file can be selected again
        });
    }
    if (customInput) {
        customInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            console.log("[Event] Custom file input changed");
            if (file) handleFileUpload(file, 'custom');
            customInput.value = ''; // Reset so the same file can be selected again
        });
    }

    // Drop Zone Visuals
    if (drataInput) setupDropZone('drata-drop-zone', drataInput);
    if (customInput) setupDropZone('custom-drop-zone', customInput);

    function setupDropZone(id, input) {
        const zone = document.getElementById(id);
        if (!zone || !input) return;

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            if (e.dataTransfer.files.length) {
                handleFileUpload(e.dataTransfer.files[0], id.startsWith('drata') ? 'drata' : 'custom');
            }
        });
    }

    async function handleFileUpload(file, type) {
        if (!file) return;
        console.log(`[File Upload] Received file: ${file.name}, Size: ${file.size} bytes, Type: ${type}`);

        if (typeof XLSX === 'undefined') {
            alert('CRITICAL ERROR: Excel processing library (XLSX) not found. Please refresh the page or check your internet connection.');
            return;
        }

        try {
            state[type].filename = file.name;

            // Immediate UI feedback
            const statusEl = type === 'drata' ? drataStatus : customStatus;
            if (statusEl) {
                statusEl.textContent = 'Reading...';
                statusEl.classList.add('loading');
            }

            const reader = new FileReader();
            reader.onerror = () => {
                alert('Error reading file. Please try again.');
            };
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    showSheetSelector(workbook, type);
                } catch (parseError) {
                    console.error("File Parse Error:", parseError);
                    alert('Error parsing Excel file. Please ensure it is a valid .xlsx or .xls file.');
                    updateUI(type); // Reset status
                }
            };
            reader.readAsArrayBuffer(file);
        } catch (uploadError) {
            console.error("Upload Error:", uploadError);
            alert('File upload failed. Check the console for details.');
        }
    }

    function showSheetSelector(workbook, type) {
        sheetList.innerHTML = '';
        workbook.SheetNames.forEach((name, index) => {
            const item = document.createElement('div');
            item.className = 'sheet-item';
            item.innerHTML = `
                <input type="checkbox" id="sheet-${index}" value="${name}" ${index === 0 ? 'checked' : ''}>
                <label for="sheet-${index}">${name}</label>
            `;
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = item.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                }
            });
            sheetList.appendChild(item);
        });

        headerRowInput.value = 1; // Reset to default
        sheetModal.style.display = 'flex';

        // Clear previous listeners by cloning fresh from the DOM
        const oldConfirmBtn = document.getElementById('confirm-load-btn');
        const oldCancelBtn = document.getElementById('cancel-load-btn');
        const oldCloseBtn = document.getElementById('close-sheet-modal');

        const newConfirmBtn = oldConfirmBtn.cloneNode(true);
        const newCancelBtn = oldCancelBtn.cloneNode(true);
        const newCloseBtn = oldCloseBtn.cloneNode(true);

        oldConfirmBtn.parentNode.replaceChild(newConfirmBtn, oldConfirmBtn);
        oldCancelBtn.parentNode.replaceChild(newCancelBtn, oldCancelBtn);
        oldCloseBtn.parentNode.replaceChild(newCloseBtn, oldCloseBtn);

        newConfirmBtn.addEventListener('click', () => {
            const selectedSheets = Array.from(sheetList.querySelectorAll('input:checked')).map(cb => cb.value);
            if (selectedSheets.length === 0) {
                alert('Please select at least one tab to load.');
                return;
            }
            const headerRow = parseInt(headerRowInput.value) || 1;
            sheetModal.style.display = 'none';
            processSheets(workbook, selectedSheets, type, headerRow);
        });

        const closeModal = () => {
            sheetModal.style.display = 'none';
            updateUI(type); // Reset status
        };

        newCancelBtn.addEventListener('click', closeModal);
        newCloseBtn.addEventListener('click', closeModal);
    }

    function processSheets(workbook, selectedSheets, type, headerRow = 1) {
        try {
            let combinedData = [];
            selectedSheets.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                // range: headerRow - 1 because SheetJS uses 0-indexed rows
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: headerRow - 1 });
                combinedData = combinedData.concat(jsonData);
            });

            if (combinedData.length > 0) {
                console.log(`[processSheets] Data loaded: ${combinedData.length} rows`);
                state[type].data = combinedData;

                // Get all columns from all rows to ensure nothing is missed
                const allColumns = new Set();
                combinedData.forEach(row => {
                    Object.keys(row).forEach(key => allColumns.add(key));
                });
                const columns = Array.from(allColumns);
                console.log(`[processSheets] Columns detected:`, columns);
                state[type].columns = columns;

                // Smart auto-detection
                const idTerms = ['id', 'reference', 'ref', 'code', 'number', 'ctrl', 'control id'];
                const descTerms = ['description', 'text', 'title', 'name', 'control text'];

                state[type].idColumn = columns.find(c => idTerms.some(term => String(c).toLowerCase().includes(term))) || columns[0];
                state[type].selectedColumn = columns.find(c => descTerms.some(term => String(c).toLowerCase().includes(term))) || columns[0];

                console.log(`[processSheets] Calling updateUI(${type})`);
                updateUI(type);
                saveState();
            } else {
                alert('No data found in the selected tab(s).');
                updateUI(type);
            }
        } catch (error) {
            console.error("Processing Error:", error);
            alert('Error processing selected sheets.');
            updateUI(type);
        }
    }

    // Column Selection Handlers
    drataIdSelect.addEventListener('change', (e) => {
        state.drata.idColumn = e.target.value;
        renderPreview('drata');
        saveState();
    });

    drataSelect.addEventListener('change', (e) => {
        state.drata.selectedColumn = e.target.value;
        renderPreview('drata');
        updateSummary();
        saveState();
    });

    customSelect.addEventListener('change', (e) => {
        state.custom.selectedColumn = e.target.value;
        renderPreview('custom');
        updateSummary();
        renderMappingTable();
        saveState();
    });

    customIdSelect.addEventListener('change', (e) => {
        state.custom.idColumn = e.target.value;
        renderPreview('custom');
        renderMappingTable();
        saveState();
    });

    function updateUI(type) {
        const item = state[type];
        const statusEl = type === 'drata' ? drataStatus : customStatus;
        const filenameEl = type === 'drata' ? drataFilename : customFilename;
        const countEl = type === 'drata' ? drataRowCount : customRowCount;
        const containerEl = type === 'drata' ? drataColContainer : customColContainer;
        const selectEl = type === 'drata' ? drataSelect : customSelect;
        const idSelectEl = type === 'drata' ? drataIdSelect : customIdSelect;
        const previewContainer = document.getElementById(`${type}-preview-container`);

        if (item.data) {
            if (statusEl) {
                statusEl.textContent = 'Loaded';
                statusEl.classList.add('loaded');
            }
            if (filenameEl) filenameEl.textContent = item.filename;
            if (countEl) countEl.textContent = `(${item.data.length} rows loaded)`;
            if (containerEl) containerEl.style.display = 'flex';
            if (previewContainer) previewContainer.style.display = 'block';

            // Populate Dropdown
            if (selectEl) {
                selectEl.innerHTML = '';
                item.columns.forEach(col => {
                    const option = document.createElement('option');
                    option.value = col;
                    option.textContent = col;
                    if (col === item.selectedColumn) option.selected = true;
                    selectEl.appendChild(option);
                });
            }

            if (idSelectEl) { // Populate ID column for either Drata or Custom
                // Ensure idColumn is valid for current columns
                if (item.idColumn && !item.columns.includes(item.idColumn)) {
                    const idTerms = ['id', 'reference', 'ref', 'code', 'number', 'ctrl', 'control id'];
                    item.idColumn = item.columns.find(c => idTerms.some(term => c.toLowerCase().includes(term))) || item.columns[0];
                }

                idSelectEl.innerHTML = '';
                item.columns.forEach(col => {
                    const option = document.createElement('option');
                    option.value = col;
                    option.textContent = col;
                    if (col === item.idColumn) option.selected = true;
                    idSelectEl.appendChild(option);
                });
            }

            renderPreview(type);
        }

        updateSummary();
    }

    function renderPreview(type) {
        const item = state[type];
        const table = document.getElementById(`${type}-preview-table`);
        if (!item.data || !table) return;

        const columns = item.columns;
        const rows = item.data.slice(0, 5); // Just show first 5

        // Create colgroups for direct width control
        let colgroupHtml = '<colgroup>';
        columns.forEach((_, idx) => {
            colgroupHtml += `<col id="${type}-preview-col-${idx}" style="width: 200px;">`;
        });
        colgroupHtml += '</colgroup>';

        let html = colgroupHtml + '<thead><tr>';
        columns.forEach((col, idx) => {
            const isSelected = col === item.selectedColumn;
            const isId = type === 'drata' && col === item.idColumn;
            let cls = '';
            if (isSelected) cls = 'preview-selected';
            if (isId) cls = (cls ? cls + ' ' : '') + 'preview-id';

            html += `<th class="${cls}" data-col-index="${idx}">${col}${isSelected ? ' (Desc)' : ''}${isId ? ' (ID)' : ''}<div class="resizer"></div></th>`;
        });
        html += '</tr></thead><tbody>';

        rows.forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                const isSelected = col === item.selectedColumn;
                const isId = col === item.idColumn;
                let cls = '';
                if (isSelected) cls = 'preview-selected';
                if (isId) cls = (cls ? cls + ' ' : '') + 'preview-id';

                const val = getColumnValue(row, col);
                const displayVal = (val !== undefined && val !== null) ? String(val) : '';
                html += `<td class="${cls}">${displayVal}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody>';
        table.innerHTML = html;

        // Initialize resizers for this specific table
        initTableResizers(table, type + '-preview-col');
    }

    function updateSummary() {
        if (state.drata.data && state.custom.data) {
            summarySection.style.display = 'flex';
            drataPreview.textContent = state.drata.selectedColumn || 'None';
            customPreview.textContent = state.custom.selectedColumn || 'None';
        } else {
            summarySection.style.display = 'none';
        }
    }

    // Persistence Logic
    function saveState() {
        // We only save metadata and selections to LocalStorage to avoid quota issues with large datasets
        const { drata, custom, mappings, comments, threshold, activeTab, stopwords, columnWidths, aiEnabled, modelSource, customHost, gapAnalysisEnabled, geminiApiKey, aiProvider, aiBaseUrl, aiModel, aiPromptTemplate, aiGroupPromptTemplate, autoLoadModel } = state;
        const stateToSave = { drata, custom, mappings, comments, threshold, activeTab, stopwords, columnWidths, aiEnabled, modelSource, customHost, gapAnalysisEnabled, geminiApiKey, aiProvider, aiBaseUrl, aiModel, aiPromptTemplate, aiGroupPromptTemplate, autoLoadModel };

        try {
            localStorage.setItem('controlMapperState', JSON.stringify(stateToSave));
        } catch (e) {
            console.warn('LocalStorage quota exceeded, saving limited metadata');
            const metadataOnly = {
                ...stateToSave,
                drata: { ...drata, data: null },
                custom: { ...custom, data: null }
            };
            localStorage.setItem('controlMapperState', JSON.stringify(metadataOnly));
        }
    }

    function loadState() {
        const saved = localStorage.getItem('controlMapperState');
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(state, parsed);

            // Enforce defaults if saved as empty strings
            if (!state.aiPromptTemplate) state.aiPromptTemplate = DEFAULT_AI_PROMPT_TEMPLATE;
            if (!state.aiGroupPromptTemplate) state.aiGroupPromptTemplate = DEFAULT_AI_GROUP_PROMPT_TEMPLATE;

            // Migration: update old drata placeholders
            if (state.aiPromptTemplate) {
                state.aiPromptTemplate = state.aiPromptTemplate.replace(/{{drataText}}/g, '{{controlLibraryText}}');
            }
            if (state.aiGroupPromptTemplate) {
                state.aiGroupPromptTemplate = state.aiGroupPromptTemplate.replace(/{{drataControlsList}}/g, '{{controlLibraryList}}');
            }

            // Migration: convert old single mappings (string) to arrays
            if (state.mappings) {
                Object.keys(state.mappings).forEach(key => {
                    if (typeof state.mappings[key] === 'string') {
                        state.mappings[key] = [state.mappings[key]];
                    }
                });
            }

            // Sync UI Elements
            if (topXInput) topXInput.value = state.topX || 5;
            if (sortBySelect) sortBySelect.value = state.sortBy || 'semantic';
            if (aiToggle) aiToggle.checked = state.aiEnabled !== undefined ? state.aiEnabled : true;
            if (gapAnalysisToggle) gapAnalysisToggle.checked = state.gapAnalysisEnabled || false;
            if (geminiApiKeyInput) geminiApiKeyInput.value = state.geminiApiKey || '';
            if (aiProviderSelect) {
                aiProviderSelect.value = state.aiProvider || 'gemini';
                if (aiBaseUrlContainer) {
                    aiBaseUrlContainer.style.display = aiProviderSelect.value === 'openai' ? 'flex' : 'none';
                }
            }
            if (aiBaseUrlInput) aiBaseUrlInput.value = state.aiBaseUrl || '';
            if (aiModelNameInput) aiModelNameInput.value = state.aiModel || (state.aiProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o');
            if (aiPromptTemplateInput) aiPromptTemplateInput.value = state.aiPromptTemplate || '';
            if (aiGroupPromptTemplateInput) aiGroupPromptTemplateInput.value = state.aiGroupPromptTemplate || '';
            if (autoLoadToggle) autoLoadToggle.checked = state.autoLoadModel !== undefined ? state.autoLoadModel : true;

            if (state.drata.data) updateUI('drata');
            if (state.custom.data) updateUI('custom');

            switchTab(state.activeTab || 'upload');
            if (state.activeTab === 'mapping') {
                renderMappingTable();
                applySavedColumnWidths();
            }

            // Automatic background loading
            if (state.autoLoadModel !== false && state.aiEnabled) {
                console.log("Auto-loading AI model in background...");
                initSemanticPipeline();
            }
        }
        initResizableColumns();
    }

    function initResizableColumns() {
        const table = document.getElementById('mapping-table');
        if (!table) return;
        initTableResizers(table, 'col');
    }

    function initTableResizers(table, colIdPrefix) {
        const resizers = table.querySelectorAll('.resizer');

        resizers.forEach(resizer => {
            const th = resizer.parentElement;
            const colIndex = th.getAttribute('data-col-index');
            if (colIndex === null) return;

            const colEl = document.getElementById(`${colIdPrefix}-${colIndex}`);

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const startX = e.pageX;
                const startWidth = colEl.offsetWidth || th.offsetWidth;

                resizer.classList.add('resizing');

                const onMouseMove = (moveEvent) => {
                    const width = startWidth + (moveEvent.pageX - startX);
                    if (width > 40) { // Min width
                        colEl.style.width = width + 'px';
                        if (colIdPrefix === 'col') { // Only save state for mapping table
                            state.columnWidths[`col-${colIndex}`] = width + 'px';
                        }
                    }
                };

                const onMouseUp = () => {
                    resizer.classList.remove('resizing');
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    if (colIdPrefix === 'col') saveState();
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        });
    }

    function applySavedColumnWidths() {
        Object.keys(state.columnWidths).forEach(colId => {
            const colEl = document.getElementById(colId);
            if (colEl) {
                colEl.style.width = state.columnWidths[colId];
            }
        });
    }
});
