// Global variables to store center phenotype and links
let centerPheno = null;
let links = [];
let pThreshold = 1e-4;
let betaThreshold = 0.01;
let betaSign = 0;
let nodes = [];
let activeNode = null;
let graphData = null;
let ancestryToggle = null;
let ancestryLower = null; // Declare ancestryLower as a global variable, and use let instead of const
let comparison_on_off = false; // Declare comparison_on_off as a global variable
let anc1 = null; // Declare anc1 as a global variable
let anc2 = null; // Declare anc2 as a global variable
// How many SNPs the node view shows. Must match TOP_SNPS in server.js.
const TOP_SNPS = 150;

// Edge thickness source in comparison mode: 'a1', 'a2' or 'max' (default).
// Resets on reload because it is a plain variable, which is the specified
// behaviour.
let betaSource = 'max';
let betaColumn2 = null; // Declare betaColumn2 as a global variable
let pColumn2 = null; // Declare pColumn2 as a global variable
let pThreshold2 = 1e-4; // Declare pThreshold2 as a global variable, default to 1e-4

// Function to parse query parameters
function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        ancestry: params.get('ancestry'),
        // pvalue will be given in scientific notation, and we should pull the exponent. So if it is 1e-10, we should get -10
        pvalue: parseFloat(params.get('pvalue')).toExponential().split('e')[1],
        // pvalue: params.get('pvalue'),
        centerPheno: params.get('centerPheno')
    };
}

const params = getQueryParams();
centerPheno = params.centerPheno;

// The toggle travels in the query string, the same way ancestry and pvalue
// do, so opening the node view from a masked network view keeps the setting.
HierarchyMask.readParams(new URLSearchParams(window.location.search))
             .setCenter(centerPheno);

ancestryLower = params.ancestry.toLowerCase(); // Initialize ancestryLower from the query parameter
let betaColumn = `beta.${ancestryLower}`;
let pColumn = `pval.${ancestryLower}`;
// getQueryParams returns the exponent ("-4"), not the threshold itself
pThreshold = Math.pow(10, parseFloat(params.pvalue));

// Metadata for the centre phenotype, kept separately so a strict threshold
// that removes every centre row cannot leave the node unlabelled.
let centerMeta = null;

// Ask the server for the centre phenotype's neighbourhood under the active
// filters. Replaces the per-node CSVs, which had to be downloaded whole (up
// to ~230 MB) before the browser could filter them.
// The thresholds go to the server so it can skip SNPs this page would then
// discard and backfill from further down the ranking, keeping the view full
// whenever enough SNPs qualify. That makes the response depend on the
// sliders, so they re-fetch (debounced) rather than re-rendering in place.
async function fetchRows() {
    const params = new URLSearchParams({
        node: centerPheno,
        ancestry: comparison_on_off ? anc1 : ancestryLower,
        pvalue: pThreshold
    });
    if (comparison_on_off && anc2) {
        params.set('ancestry2', anc2);
        params.set('pvalue2', pThreshold2);
    }
    try {
        const response = await fetch(`/api/page2/rows?${params}`);
        if (!response.ok) {
            console.error('Error loading rows:', (await response.json()).error);
            return null;
        }
        const payload = await response.json();
        centerMeta = payload.center;
        snpTotals = {
            available: payload.availableSnps,  // SNPs this phenotype has in total
            fetched: payload.fetchedSnps,      // how many the cap let through
            more: payload.moreAvailable,       // were there more that qualified?
            limit: payload.limit
        };
        console.log('Number of rows:', payload.rows.length);
        return payload.rows;
    } catch (error) {
        console.error('Error loading rows:', error);
        return null;
    }
}

async function loadData() {
    return fetchRows();
}

// Set by fetchRows, read by updatePanels.
let snpTotals = { available: 0, fetched: 0, more: false, limit: 0 };

/**
 * Bottom-left overlays: live counts, plus the cap warning.
 *
 * The warning fires when more SNPs cleared the filters than the view can
 * show. The server settles that by asking for one more than it can display
 * and reporting whether it came back, so a view that is short only because
 * few SNPs qualify says nothing.
 */
// Enable/label the edge-thickness radios. They only apply in comparison mode,
// so they stay greyed out until a second ancestry is picked.
function setThicknessControls(enabled, a1Name, a2Name) {
    d3.select('#thickness-controls').style('opacity', enabled ? 1 : 0.5);
    d3.selectAll('.beta-source').property('disabled', !enabled);
    if (enabled) {
        d3.select('#bs-a1-label').text(a1Name.toUpperCase());
        d3.select('#bs-a2-label').text(a2Name.toUpperCase());
    } else {
        d3.select('#bs-a1-label').text('Ancestry 1');
        d3.select('#bs-a2-label').text('Ancestry 2');
    }
}

function updatePanels(nodes, links) {
    const snps = nodes.filter(n => n.id.startsWith('rs'));
    const phenos = nodes.filter(n => !n.id.startsWith('rs'));
    const { available, more, limit } = snpTotals;

    const same = links.filter(l => l.direction >= 0).length;
    Panels.summary([
        ['SNPs', snps.length],
        ['Phenotypes', phenos.length],
        ['Associations', links.length],
        [comparison_on_off ? '\u00a0\u00a0concordant' : '\u00a0\u00a0positive', same],
        [comparison_on_off ? '\u00a0\u00a0discordant' : '\u00a0\u00a0negative', links.length - same],
        ['SNPs for this phenotype', available]
    ]);

    // The server tells us directly whether more SNPs cleared the filters than
    // fit on screen, so the warning no longer has to infer it.
    Panels.snpWarning(limit, more);
}

/**
 * Drop outer-ring phenotypes related to the centre, and their edges.
 *
 * Runs after updateNodes rather than inside it. updateNodes drops SNPs with
 * fewer than two edges, and hiding a related phenotype can take a SNP down
 * to one - the edge to the centre. Those SNPs stay: they are associated with
 * the centre phenotype, which is what the view is about, and removing them
 * would make the toggle look like it had thinned the centre's own evidence.
 */
function applyHierarchyMask({ nodes, edges }) {
    if (!HierarchyMask.enabled) return { nodes, edges };
    const hidden = new Set(nodes
        .filter(n => !n.id.startsWith('rs') && n.id !== centerPheno
                     && HierarchyMask.isRelatedToCenter(n.id))
        .map(n => n.id));
    if (!hidden.size) return { nodes, edges };
    return {
        nodes: nodes.filter(n => !hidden.has(n.id)),
        edges: edges.filter(e => !hidden.has(e.source.id) && !hidden.has(e.target.id))
    };
}

// Re-render from the rows already loaded. The p-value sliders use this.
function redraw() {
    if (!graphData) {
        console.warn('Data is not loaded yet.');
        return;
    }

    const network = initializeNetwork(graphData, betaColumn, pColumn, betaColumn2, pColumn2, comparison_on_off);
    const filteredEdges = updateEdges(pThreshold, betaThreshold, betaSign, network.links, graphData, pThreshold2, comparison_on_off);
    const masked = updateNodes(filteredEdges, network.nodes);
    const { nodes: filteredNodes, edges: filteredLinks } = applyHierarchyMask(masked);
    nodes = filteredNodes;
    links = filteredLinks;
    renderNetwork(filteredNodes, filteredLinks, graphData, network.width, network.height, centerPheno, network.centerX, network.centerY, network.nodeMap, comparison_on_off);

    if (activeNode) {
        highlightNode(activeNode, filteredLinks, comparison_on_off);
    }
}

// Changing the ancestry changes which SNPs rank highest, so that needs a
// round trip; everything else redraws locally.
async function refresh() {
    const rows = await fetchRows();
    if (!rows) return;
    graphData = rows;
    redraw();
}

loadData().then(async (data) => {
    if (data) {
        graphData = data;

        // Which ancestries actually have data for this phenotype. The old
        // check read the loaded rows; the server answers it directly against
        // the unfiltered table.
        const ORDER = ['amr', 'eas', 'afr', 'eur', 'meta'];
        let base_ancestries = ORDER.slice();
        try {
            const available = await fetch(`/api/node/${centerPheno}/ancestries`)
                .then(r => r.json());
            base_ancestries = ORDER.filter(a => available.ancestries.includes(a));
        } catch (error) {
            console.error('Error loading ancestry availability:', error);
        }


        // Define the log scale range
        const minLogP = -12; // Corresponding to 10^-10
        const maxLogP = -4;  // Corresponding to 10^-4

        // Add a p-value threshold slider with log scale and text input
        const pValueSlider = d3.select('body')
            .append('div')
            .style('position', 'absolute')
            .style('top', '10px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white')
            .html(`
                <div>
                    <label for="pvalue-slider" id="pvalue-label-1">Select p-value threshold:</label>
                </div>
                <div style="margin-top: 5px;">
                    <input type="range" id="pvalue-slider" name="pvalue-slider" min="${minLogP}" max="${maxLogP}" step="0.1" value="${maxLogP}">
                    <input type="number" id="pvalue-input" step="0.1" min="${minLogP}" max="${maxLogP}" value="${maxLogP}">
                    <span id="pvalue-threshold">1e${maxLogP}</span>
                </div>
            `);

        let debounceTimer;
        const updatePValueThreshold = (logP, { defer = false } = {}) => {
            pThreshold = Math.pow(10, logP); // Convert back to linear scale
            d3.select('#pvalue-threshold').text(`1e${logP}`);

            if (defer) return;   // initial seeding; the first render happens below

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (!graphData) {
                    console.warn("Data is not loaded yet.");
                    return;
                }
                
                refresh();   // selection depends on the threshold now
            }, 200); // 200ms debounce delay
        };

        // Initialize the slider and input with the value from the query parameter
        const initialPValue = params.pvalue || maxLogP;
        d3.select('#pvalue-slider').property('value', initialPValue);
        d3.select('#pvalue-input').property('value', initialPValue);
        updatePValueThreshold(initialPValue, { defer: true });

        d3.select('#pvalue-slider').on('input', function () {
            const logP = this.value;
            d3.select('#pvalue-input').property('value', logP);
            updatePValueThreshold(logP);
        });

        d3.select('#pvalue-input').on('input', function () {
            const logP = this.value;
            d3.select('#pvalue-slider').property('value', logP);
            updatePValueThreshold(logP);
        });

        d3.select('#pvalue-label-1')
        .text(`Select p-value threshold for ${ancestryLower}`);

        // add a second p value slider for when a second ancestry is selected
        const pValueSlider2 = d3.select('body')
            .append('div')
            .style('position', 'absolute')
            .style('top', '75px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white')
            .html(`
                <div>
                    <label for="pvalue-slider2" id="pvalue-label-2">Select second p-value threshold:</label>
                </div>
                <div style="margin-top: 5px;">
                    <input type="range" id="pvalue-slider2" name="pvalue-slider2" min="${minLogP}" max="${maxLogP}" step="0.1" value="${maxLogP}">
                    <input type="number" id="pvalue-input2" step="0.1" min="${minLogP}" max="${maxLogP}" value="${maxLogP}">
                    <span id="pvalue-threshold2">1e${maxLogP}</span>
                </div>
            `);

        let debounceTimer2;
        const updatePValueThreshold2 = (logP) => {
            pThreshold2 = Math.pow(10, logP); // Convert back to linear scale
            d3.select('#pvalue-threshold2').text(`1e${logP}`);

            clearTimeout(debounceTimer2);
            debounceTimer2 = setTimeout(() => {
                if (!graphData) {
                    console.warn("Data is not loaded yet.");
                    return;
                }
                console.log('comparison_on_off:', comparison_on_off);
                refresh();   // selection depends on the threshold now
            }, 200); // 200ms debounce delay
        }

        // Initialize the slider and input with the value from the query parameter
        const initialPValue2 = maxLogP; // Default to the same value as the first slider
        d3.select('#pvalue-slider2').property('value', initialPValue2);
        d3.select('#pvalue-input2').property('value', initialPValue2);
        // updatePValueThreshold2(initialPValue2);

        d3.select('#pvalue-slider2').on('input', function () {
            const logP = this.value;
            d3.select('#pvalue-input2').property('value', logP);
            updatePValueThreshold2(logP);
        });

        d3.select('#pvalue-input2').on('input', function () {
            const logP = this.value;
            d3.select('#pvalue-slider2').property('value', logP);
            updatePValueThreshold2(logP);
        });

        // make the second slider grayed out and unclickable until a second ancestry is selected
        d3.select('#pvalue-slider2').property('disabled', true);
        d3.select('#pvalue-input2').property('disabled', true);
        d3.select('#pvalue-threshold2').style('color', 'gray');
        d3.select('#pvalue-slider2').style('opacity', 0.5);
        d3.select('#pvalue-input2').style('opacity', 0.5);

        // Add a beta threshold slider with text input
        // const betaThresholdSlider = d3.select('body')
        //     .append('div')
        //     .style('position', 'absolute')
        //     .style('top', '130px')
        //     .style('left', '10px')
        //     .style('background', 'transparent')
        //     .style('padding', '10px')
        //     .style('color', 'white')
        //     .html(`
        //         <div>
        //             <label for="beta-threshold-slider">Select beta threshold:</label>
        //         </div>
        //         <div style="margin-top: 5px;">
        //             <input type="range" id="beta-threshold-slider" name="beta-threshold-slider" min="0" max="1" step="0.01" value="0">
        //             <input type="number" id="beta-input" step="0.01" min="0" max="1" value="0">
        //             <span id="beta-threshold">0</span>
        //         </div>
        //     `);


        // let debounceTimerBeta;
        // const updateBetaThreshold = (value) => {
        // betaThreshold = value;
        // d3.select('#beta-threshold').text(betaThreshold);

        // clearTimeout(debounceTimerBeta);
        // debounceTimerBeta = setTimeout(() => {
        //     if (!graphData) {
        //         console.warn("Data is not loaded yet.");
        //         return;
        //     }

        //     const network = initializeNetwork(graphData, betaColumn, pColumn);
        //     const filteredEdges = updateEdges(pThreshold, betaThreshold, betaSign, network.links, graphData);
        //     // const categories = filteredEdges.map(l => l.target.category);
        //     const { nodes: filteredNodes, edges: filteredLinks } = updateNodes(filteredEdges, network.nodes);
        //     nodes = filteredNodes;
        //     links = filteredLinks;
        //     renderNetwork(filteredNodes, filteredLinks, graphData, network.width, network.height, centerPheno, network.centerX, network.centerY, network.nodeMap, comparison_on_off);

        //     if (activeNode) {
        //         highlightNode(activeNode, filteredLinks, comparison_on_off);
        //     }
        // }, 200); // 200ms debounce delay
        // };

        // // Initialize the slider and input with the value from the query parameter
        // const initialBeta = 0.0;
        // d3.select('#beta-threshold-slider').property('value', initialBeta);
        // d3.select('#beta-input').property('value', initialBeta);
        // updateBetaThreshold(initialBeta);

        // d3.select('#beta-threshold-slider').on('input', function () {
        // const value = this.valueAsNumber;
        // d3.select('#beta-input').property('value', value);
        // updateBetaThreshold(value);
        // });

        // d3.select('#beta-input').on('input', function () {
        // const value = this.valueAsNumber;
        // d3.select('#beta-threshold-slider').property('value', value);
        // updateBetaThreshold(value);
        // });

        // Create a container div for the button and info text
        const infoContainer = d3.select('body')
        .append('div')
        .style('position', 'absolute')
        .style('top', '10px')
        .style('right', '10px')
        .style('background', 'transparent')
        .style('padding', '10px')
        .style('color', 'white');

        // Add the button
        const infoButton = infoContainer.append('button')
        .text('About Phenotype View')
        .style('background', '#444')
        .style('color', 'white')
        .style('border', 'none')
        .style('padding', '8px 12px')
        .style('cursor', 'pointer')
        .style('border-radius', '5px')
        .on('click', () => {
            const isVisible = infoText.style('display') === 'block';
            infoText.style('display', isVisible ? 'none' : 'block');
        });

        // Add the info text (initially hidden)
        const infoText = infoContainer.append('div')
        .attr('class', 'about-panel')
        .style('display', 'none')
        .html(`
            <h2>Phenotype View</h2>
            <p>The center node is the phenotype selected from the overall graph. The
            inner ring is its 150 most strongly associated SNPs, ranked by z-score
            (the effect size divided by its standard error). That is a hard limit:
            loosening the p-value filter will not show more than 150, and the note at
            the bottom left says so whenever more SNPs qualify than fit.</p>

            <p>SNPs are arranged and colored by chromosome, which also appears in the
            label when you hover over one. The outer ring is the other phenotypes
            associated with those same SNPs, arranged and colored by category; these
            are the center phenotype's nearest neighbors in the larger graph.</p>

            <p>SNPs only to an outer phenotype will not be shown in this view. SNPs
            connected only to the center phenotype may be shown, but only when there
            are less than 150 SNPs connecting the center phenotype to an outer
            phenotype. We prioritize these type of edges because they are what the
            phenotype view was designed to explore.</p>

            <h3>Reading the links</h3>
            <p>Links are colored by the direction of the association with the
            phenotype, blue for positive and red for negative, and their thickness
            follows the effect size.</p>

            <p>Selecting a second ancestry switches to a comparison: only SNPs
            significant in both are kept, and links turn green where the association
            runs the same way in both ancestries and orange where it runs opposite.
            The two p-value thresholds move independently, SNPs are ranked by whichever
            ancestry supports them less, and the edge thickness control chooses which
            ancestry's effect size sets the width.</p>

            <h3>Exploring</h3>
            <p>Click a node to highlight its connections; clicking the center phenotype
            brings back the full network. Double-click a phenotype to open its own
            Phenotype view, or right-click one to open the SNP view for the edge
            between it and the center. "Reset view" clears the selection, and the panel
            at the bottom left counts what is currently drawn.</p>
        `);

        // // add a download button to download data as a csv file
        // const downloadButton = infoContainer.append('button')
        // .text('Download Data')
        // .style('display', 'block')
        // .style('margin-top', '10px')
        // .style('background', '#444')
        // .style('color', 'white')
        // .style('border', 'none')
        // .style('padding', '8px 12px')
        // .style('cursor', 'pointer')
        // .style('border-radius', '5px')
        // .on('click', () => {
        //     const csvString = d3.csvFormat(data);
        //     const blob = new Blob([csvString], { type: 'text/csv' });
        //     const url = URL.createObjectURL(blob);
        //     const a = document.createElement('a');
        //     a.href = url;
        //     a.download = 'data.csv';
        //     document.body.appendChild(a);
        //     a.click();
        //     document.body.removeChild(a);
        // });

        const downloadButton = infoContainer.append('button')
        .text('Download Data')
        .style('display', 'block')
        .style('margin-top', '10px')
        .style('background', '#444')
        .style('color', 'white')
        .style('border', 'none')
        .style('padding', '8px 12px')
        .style('cursor', 'pointer')
        .style('border-radius', '5px')
        .on('click', () => {
            // Every SNP for this phenotype, not just the 150 on screen, which
            // is what the cap warning promises. Served as CSV by the API.
            window.location.href = `/api/page2/download?node=${encodeURIComponent(centerPheno)}`;
        });

        // --- Persistent search bar container ---
        let searchContainer = d3.select('body')
            .append('div')
            .attr('id', 'search-bar-container')
            .style('position', 'absolute')
            .style('top', '320px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white');

        searchContainer.html(`
            <input type="text" id="node-search" placeholder="Search node..." style="width: 180px; padding: 5px;">
            <div id="search-results" style="background: #222; color: white; margin-top: 2px; max-height: 150px; overflow-y: auto; display: none;"></div>
        `);

        // --- Helper function to update search results ---
        function updateSearchResults(query) {
            const resultsDiv = d3.select('#search-results');
            resultsDiv.html(''); // clear previous results

            if (!query) {
                resultsDiv.style('display', 'none');
                return;
            }

            // Filter nodes by name or id
            const matches = nodes.filter(d =>
                d.id.toLowerCase().includes(query.toLowerCase()) ||
                (d.label && d.label.toLowerCase().includes(query.toLowerCase()))
            ).slice(0, 20); // limit to top 20 matches

            if (matches.length === 0) {
                resultsDiv.style('display', 'none');
                return;
            }

            matches.forEach(node => {
                resultsDiv.append('div')
                    .text(node.label || node.id)
                    .style('padding', '2px 5px')
                    .style('cursor', 'pointer')
                    .on('click', () => {
                        d3.select('#node-search').property('value', node.label || node.id);
                        resultsDiv.style('display', 'none');
                        // Trigger node highlight
                        highlightNode(node, links, comparison_on_off);
                    });
            });

            resultsDiv.style('display', 'block');
        }

        // --- Attach search input event ---
        d3.select('#node-search').on('input', function () {
            const query = this.value;
            updateSearchResults(query);
        });

        // --- Optional: hide results when clicking outside ---
        d3.select('body').on('click', function (event) {
            if (!event.target.closest('#search-bar-container')) {
                d3.select('#search-results').style('display', 'none');
            }
        });


        // add a checkbox dropdown menu called compare ancestries
        const compareAncestries = d3.select('body')
            .append('div')
            .style('position', 'absolute')
            .style('top', '145px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white')
            .html(`
                <label>Select ancestry:</label>
                <div id="ancestry-checkboxes" style="border: 1px solid white; padding: 5px; max-width: 200px;">
                    ${base_ancestries.map(ancestry => `
                        <div>
                            <input type="checkbox" class="ancestry-option" value="${ancestry}" id="chk-${ancestry}">
                            <label for="chk-${ancestry}">${ancestry.toUpperCase()}</label>
                        </div>
                    `).join('\n')}
                </div>
                <p style="font-size: 12px;">(Select two to compare)</p>
                <div id="thickness-controls" style="margin-top: 4px; opacity: 0.5;">
                    <label>Edge thickness from:</label>
                    <div id="thickness-radios" style="border: 1px solid white; padding: 5px; max-width: 200px;">
                        <div><input type="radio" name="beta-source" class="beta-source" value="a1" id="bs-a1" disabled><label for="bs-a1" id="bs-a1-label">Ancestry 1</label></div>
                        <div><input type="radio" name="beta-source" class="beta-source" value="a2" id="bs-a2" disabled><label for="bs-a2" id="bs-a2-label">Ancestry 2</label></div>
                        <div><input type="radio" name="beta-source" class="beta-source" value="max" id="bs-max" checked disabled><label for="bs-max">Max of both</label></div>
                    </div>
                </div>

            `);

        const checkbox = document.querySelector(`#chk-${ancestryLower}`);
        console.log(checkbox);
        if (checkbox) {
            // Only reflect the query string in the UI. Dispatching 'change' here
            // re-fetched and re-rendered the entire graph on top of the initial
            // render below, doubling load time on large views.
            checkbox.checked = true;
        }


        // Which ancestry's beta sets edge thickness in comparison mode. Kept
        // deliberately separate from ranking: z-score decides which SNPs are
        // shown, beta decides how thick the edge is drawn.
        //
        // A plain variable, so it survives ancestry and p-value changes (which
        // only redraw) and resets to "max" on reload, as specified. Opening a
        // node or edge view is a new tab, so that starts at the default too.
        d3.selectAll('.beta-source').on('change', function () {
            betaSource = this.value;
            redraw();
        });

        // Reset button, replacing the Escape key.
        // Its own panel, so the layout below can put it last.
        d3.select('body')
            .append('div')
            .attr('id', 'reset-container')
            .style('position', 'absolute')
            .style('left', '10px')
            .style('padding', '10px')
            .html(`<button id="reset-view" style="background: #444; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 5px;">Reset view</button>`);
        d3.select('#reset-view').on('click', () => resetView());

        // Hand-written offsets collided once the ancestry list, the edge
        // thickness radios and the reset button stacked up under each other.
        // Lay the column out from measured heights: search second to last,
        // reset last.
        const stack = () => Panels.stackLeft([
            pValueSlider.node(),
            pValueSlider2.node(),
            compareAncestries.node(),
            document.getElementById('hierarchy-mask-container'),
            searchContainer.node(),
            document.getElementById('reset-container')
        ].filter(Boolean));
        stack();

        // Same as page 1: the control appears only if the relation data was
        // built, and a mask=1 that the server cannot honour is turned off
        // rather than silently ignored.
        HierarchyMask.init(centerPheno).then(ok => {
            if (!ok) {
                if (HierarchyMask.enabled) {
                    console.warn('mask=1 was requested but the relation data ' +
                                 'is not built on this server');
                    HierarchyMask.enabled = false;
                }
                return;
            }
            HierarchyMask.control(redraw);
            stack();
            if (HierarchyMask.enabled) redraw();
        });
        // Listen for ancestry checkbox changes
        d3.selectAll('.ancestry-option').on('change', function () {
            const checked = d3.selectAll('.ancestry-option').nodes().filter(d => d.checked);
            
            if (checked.length > 2) {
                this.checked = false;
                alert('Please select only two ancestries.');
                return;
            }

            if (checked.length === 1) {
                // Disable the second slider
                d3.select('#pvalue-slider2').property('disabled', true);
                d3.select('#pvalue-input2').property('disabled', true);
                d3.select('#pvalue-threshold2').style('color', 'gray');
                d3.select('#pvalue-slider2').style('opacity', 0.5);
                d3.select('#pvalue-input2').style('opacity', 0.5);

                ancestryLower = checked[0].value.toLowerCase(); // Update ancestryLower when the selection changes
                console.log(`Ancestry selected: ${ancestryLower}`);
                betaColumn = `beta.${ancestryLower}`;
                pColumn = `pval.${ancestryLower}`;
                comparison_on_off = false;

                // Thickness source only means something with two ancestries
                setThicknessControls(false);

                // Update first slider’s label
                d3.select('#pvalue-label-1')
                .text(`Select p-value threshold for ${ancestryLower}`);

                // The checkbox list is already limited to ancestries that have
                // data for this phenotype, so no availability check is needed.
                refresh();
            }


            if (checked.length === 2) {
                // Turn on comparison mode
                comparison_on_off = true;

                // Enable the second slider
                d3.select('#pvalue-slider2').property('disabled', false);
                d3.select('#pvalue-input2').property('disabled', false);
                d3.select('#pvalue-threshold2').style('color', 'white');
                d3.select('#pvalue-slider2').style('opacity', 1);
                d3.select('#pvalue-input2').style('opacity', 1);

                // Assign ancestry variables
                anc1 = checked[0].value.toLowerCase();
                anc2 = checked[1].value.toLowerCase();

                setThicknessControls(true, anc1, anc2);

                // Update both labels
                d3.select('#pvalue-label-1')
                .text(`Select p-value threshold for ${anc1}`);
                d3.select('#pvalue-label-2')
                .text(`Select p-value threshold for ${anc2}`);

                betaColumn = `beta.${anc1}`;
                pColumn = `pval.${anc1}`;

                betaColumn2 = `beta.${anc2}`;
                pColumn2 = `pval.${anc2}`;

                // Optionally store in global scope if needed:
                // window.anc1 = anc1;
                // window.anc2 = anc2;
                window.comparison_on_off = comparison_on_off;

                // Refresh network
                if (!graphData) {
                    console.warn("Data is not loaded yet.");
                    return;
                }

                refresh();
            }
        });


        // Initialize the network with the default ancestry
        const network = initializeNetwork(graphData, betaColumn, pColumn);
        const filteredEdges = updateEdges(pThreshold, betaThreshold, betaSign, network.links, graphData);
        const { nodes: filteredNodes, edges: filteredLinks } = updateNodes(filteredEdges, network.nodes);
        nodes = filteredNodes;
        links = filteredLinks;
        renderNetwork(filteredNodes, filteredLinks, graphData, network.width, network.height, centerPheno, network.centerX, network.centerY, network.nodeMap, comparison_on_off);

    }
});




function updateEdges(pThreshold, betaThreshold, betaSign, links, data, pThreshold2 = null, comparison_on_off = false) {
    let filteredEdges;
    if (comparison_on_off && pThreshold2 !== null) {
        // If comparison is on, filter edges based on both pvalue and pvalue2
        filteredEdges = links.filter(l => l.pvalue < pThreshold && l.pvalue2 < pThreshold2);
        }
    else {
        // Filter edges based on the pvalue attribute
        filteredEdges = links.filter(l => l.pvalue < pThreshold);
        }
    // Filter edges based on the beta attribute
    const filteredEdgesBeta = filteredEdges.filter(l => l.beta > betaThreshold);
    // Filter edges based on the direction attribute
    let filteredEdgesDirection;
    if (betaSign === 0) {
        filteredEdgesDirection = filteredEdgesBeta;
    }
    else {
        filteredEdgesDirection = filteredEdgesBeta.filter(l => l.direction === betaSign);
    }
    // return the filtered edges
    return filteredEdgesDirection;
    }

function updateNodes(edges, nodes) {
    // Same result as before, but in two passes over the edges instead of
    // scanning them once per node (and, for the phenotypes, once per node per
    // SNP). On a large edge view that nested form was ~1e9 comparisons.

    // degree per node id; an edge counts once for a node even if it happens to
    // sit on both of its ends, matching the original `source || target` test
    const degree = new Map();
    const bump = id => degree.set(id, (degree.get(id) || 0) + 1);
    // SNPs whose surviving links include one to the centre. This, and not the
    // link count, is what decides whether a SNP belongs in a phenotype view.
    const reachesCentre = new Set();
    for (const edge of edges) {
        const s = edge.source.id;
        const t = edge.target.id;
        bump(s);
        if (t !== s) bump(t);
        if (s === centerPheno && t.startsWith('rs')) reachesCentre.add(t);
        else if (t === centerPheno && s.startsWith('rs')) reachesCentre.add(s);
    }

    // find all the nodes that have ids starting with rs
    const rsidNodes = nodes.filter(node => node.id.startsWith('rs'));
    // Keep a SNP only if one of its surviving links reaches the centre. The
    // old rule was "two or more surviving links, to anywhere", which kept
    // SNPs whose centre link had been filtered out but that still joined two
    // outer phenotypes - most of what the comparison view was drawing. It
    // also dropped SNPs whose only link is to the centre, which is the
    // opposite error: those are the centre's own evidence.
    //
    // The ordering that puts SNPs reaching an outer phenotype ahead of
    // centre-only ones lives in topSnpCte() server-side, where the 150 cap
    // is applied; by the time rows arrive here the set already honours it.
    const rsidNodesFiltered = rsidNodes.filter(node => reachesCentre.has(node.id));
    const rsidKept = new Set(rsidNodesFiltered.map(n => n.id));

    // ids with at least one edge to a surviving rsid node
    const linkedToKeptRsid = new Set();
    for (const edge of edges) {
        const s = edge.source.id;
        const t = edge.target.id;
        if (rsidKept.has(t)) linkedToKeptRsid.add(s);
        if (rsidKept.has(s)) linkedToKeptRsid.add(t);
    }

    // find all the nodes that have ids not starting with rs
    const pheNodes = nodes.filter(node => !node.id.startsWith('rs'));
    // filter phenodes to include only those with at least one edge to a node in rsidNodesFiltered
    const pheNodesFiltered = pheNodes.filter(node => linkedToKeptRsid.has(node.id));
    // combine the filtered rsidNodes and pheNodes
    const filteredNodes = rsidNodesFiltered.concat(pheNodesFiltered);

    const nodeIdSet = new Set(filteredNodes.map(n => n.id));
    const filteredEdges = edges.filter(edge =>
        nodeIdSet.has(edge.source.id) && nodeIdSet.has(edge.target.id)
    );


    // return filtered nodes and edges
    return {
        nodes: filteredNodes,
        edges: filteredEdges
    }

}   

// Function to highlight a selected node and its relevant edges
function highlightNode(aNode, links, comparison_on_off = false) {

    console.log('comparison_on_off:', comparison_on_off);
    if (!centerPheno || !links.length) {
        console.warn('highlightNode called before network was initialized.');
        return;
    }

    // make a list of the nodes that are connected to the active node
    const connected_edges = links.filter(l => l.source.id === aNode.id || l.target.id === aNode.id);
    // take whichever end of the link is the active node and make a list of the other end
    const connectedNodes = connected_edges.map(l => l.source.id === aNode.id ? l.target.id : l.source.id);
    
    const isPhenotype = !aNode.id.startsWith('rs');
    // const isRSID = aNode.id.startsWith('rs');

    // Neighbours of the active node, as a set: this used to be a scan of every
    // link for every circle, which on a node like Obesity is 289 x 14,000.
    const connectedSet = new Set(connectedNodes);

    // Animating tens of thousands of SVG elements at once is what actually
    // locks the browser up, so past a few thousand set the style outright.
    const animate = selection =>
        selection.size() > 2000 ? selection : selection.transition().duration(300);

    // Reduce opacity of all nodes except aNode, its neighbors, and center phenotype
    animate(d3.selectAll('circle'))
        .style('opacity', d => {
            if (aNode.id === centerPheno) {
                return 1;
            }
            return d.id === aNode.id || d.id === centerPheno || connectedSet.has(d.id)
                ? 1
                : 0.3;
        });

    // Highlight edges
    animate(d3.selectAll('line'))
        .style('opacity', d => {
            if (aNode.id === centerPheno) {
                // make all edges visible
                return 0.5;
            }
            else {
                let visible_opacity;
                if (comparison_on_off) {
                    visible_opacity = 1; //placeholder in case we want to change this but they should be the same for now
                } else {
                    visible_opacity = 1;
                }
                if (d.source.id === aNode.id || d.target.id === aNode.id) {
                    return visible_opacity;
                }
                if (isPhenotype) {
                    if (d.source.id === aNode.id || d.target.id === aNode.id) {
                        return visible_opacity;
                    }

                if (connectedSet.has(d.source.id) && d.target.id === centerPheno) {
                    return visible_opacity;
                }
                if (connectedSet.has(d.target.id) && d.source.id === centerPheno) {
                    return visible_opacity;
                }
                }
                return 0;
            }

        });
}

// Clear the selection and put every node and edge back to its resting state.
// This used to be bound to Escape, and only after a node had been clicked,
// since the handler was registered inside highlightNode. It is now the
// "Reset view" button under the filters.
function resetView() {
    activeNode = null;
    const animate = selection =>
        selection.size() > 2000 ? selection : selection.transition().duration(300);
    animate(d3.selectAll('circle')).style('opacity', 1);
    animate(d3.selectAll('line')).style('opacity', 0);
}



// A p-value of exactly 0 is the strongest possible association. The previous
// `parseFloat(p) || 1` idiom coerced it to 1 and silently dropped those rows;
// only a missing value should fall back to 1.
function toPvalue(value) {
    const p = parseFloat(value);
    return Number.isFinite(p) ? p : 1;
}

function initializeNetwork(data, betaColumn, pColumn, betaColumn2 = null, pColumn2 = null, comparison_on_off = false) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    const nodeMap = new Map();
    data.forEach(d => {
        if (!nodeMap.has(d.rsid)) nodeMap.set(d.rsid, { id: d.rsid, color: d.rsid_hex });
        if (!nodeMap.has(d.phe_id)) nodeMap.set(d.phe_id, { id: d.phe_id, color: d.phe_hex });
    });

    let links = data.map(d => ({
        source: nodeMap.get(d.rsid),
        target: nodeMap.get(d.phe_id),
        beta: isNaN(parseFloat(d[betaColumn])) ? NaN : Math.abs(parseFloat(d[betaColumn])),
        direction: Math.sign(parseFloat(d[betaColumn])) || 0,
        pvalue: toPvalue(d[pColumn])
    }));

    // If comparison is enabled, prepare and merge with the second set of links
    if (comparison_on_off) {
        // Create the second set of links
        const links2 = data.map(d => ({
            source: nodeMap.get(d.rsid),
            target: nodeMap.get(d.phe_id),
            beta: isNaN(parseFloat(d[betaColumn2])) ? NaN : Math.abs(parseFloat(d[betaColumn2])),
            direction: Math.sign(parseFloat(d[betaColumn2])) || 0,
            pvalue: toPvalue(d[pColumn2])
        }));

        // Create a set of valid keys from links2 for fast intersection
        const link2KeySet = new Set(links2.map(link => `${link.source.id}|${link.target.id}`));

        // Create a map from keys to link2 objects for enrichment
        const link2Map = new Map();
        links2.forEach(link => {
            const key = `${link.source.id}|${link.target.id}`;
            link2Map.set(key, link);
        });

        // Filter and enrich links from links1 that exist in links2
        links = links.filter(link => {
            const key = `${link.source.id}|${link.target.id}`;
            return link2KeySet.has(key);
        });

        links.forEach(link => {
            const key = `${link.source.id}|${link.target.id}`;
            const match = link2Map.get(key);
            if (match) {
                // take the max of the two betas
                // beta drives edge thickness; the ranking uses z separately
                link.beta = betaSource === 'a1' ? link.beta
                          : betaSource === 'a2' ? match.beta
                          : Math.max(link.beta, match.beta);
                link.pvalue2 = match.pvalue; // Optional: store pvalue from second set
                link.direction = link.direction * match.direction; // Multiply directions
            }
        });
    }

    // console log betaColumn, and the first 10 values
    console.log('betaColumn:', betaColumn);
    console.log('First 10 beta values:', links.slice(0, 10).map(l => l.beta));

    // filter out edges that have a nan beta value
    links = links.filter(l => !isNaN(l.beta));
    
    // Identify nodes that only have NaN beta edges
    const nodeEdgeMap = new Map();
    links.forEach(link => {
        if (!nodeEdgeMap.has(link.source.id)) nodeEdgeMap.set(link.source.id, []);
        if (!nodeEdgeMap.has(link.target.id)) nodeEdgeMap.set(link.target.id, []);
        nodeEdgeMap.get(link.source.id).push(link.beta);
        nodeEdgeMap.get(link.target.id).push(link.beta);
    });
    console.log('Number of links:',links.length)
    // console log the links connected to the centerPheno
    const centerNode = nodeMap.get(centerPheno);

    const validNodes = new Set();
    nodeEdgeMap.forEach((betas, nodeId) => {
        if (betas.some(beta => !isNaN(beta))) {
            validNodes.add(nodeId);
        }
    });

    // Filter nodes and links to remove those only connected by NaN beta edges
    let nodes = Array.from(nodeMap.values()).filter(node => validNodes.has(node.id));
    links = links.filter(link => validNodes.has(link.source.id) && validNodes.has(link.target.id));
    
    // make a set of links that are connected to the centerPheno
    const centerLinks = links.filter(link => link.source.id === centerPheno || link.target.id === centerPheno);
    // Take the strongest SNPs, counting distinct SNPs rather than links.
    // Slicing 150 *links* short-changed any phenotype whose rows are
    // duplicated - the five merged phenotypes carry two rows per SNP, so
    // Asthma showed 116 SNPs where 150 qualified.
    centerLinks.sort((a, b) => a.pvalue - b.pvalue);
    const topRsidNodes = new Set();
    for (const link of centerLinks) {
        topRsidNodes.add(link.source.id === centerPheno ? link.target.id : link.source.id);
        if (topRsidNodes.size >= TOP_SNPS) break;
    }
    // filter the nodes to include only the topRsidNode AND any non rsid nodes
    nodes = nodes.filter(node => topRsidNodes.has(node.id) || !node.id.startsWith('rs'))
    // filter the links to include only nodes that are still in nodes
    links = links.filter(link => topRsidNodes.has(link.source.id) || topRsidNodes.has(link.target.id));
    // calculate the degree of all the non rsid and non centerPheno nodes
    const nodeDegrees = new Map();
    nodes.forEach(node => {
        if (!node.id.startsWith('rs') && node.id !== centerPheno) {
            nodeDegrees.set(node.id, 0);
        }
    }
    );
    // calculate the degree of each node
    links.forEach(link => {
        if (nodeDegrees.has(link.source.id)) {
            nodeDegrees.set(link.source.id, nodeDegrees.get(link.source.id) + 1);
        }
        if (nodeDegrees.has(link.target.id)) {
            nodeDegrees.set(link.target.id, nodeDegrees.get(link.target.id) + 1);
        }
    });
    // remove any nodes that have a degree of 0
    nodeDegrees.forEach((degree, nodeId) => {
        if (degree <= 1) {
            nodeDegrees.delete(nodeId);
        }
    });
    console.log('nodeDegrees:', nodeDegrees);
    // sort the nodeDegrees by value and take the top 100
    // const topNodesByDegree = Array.from(nodeDegrees.entries()).sort((a, b) => b[1] - a[1]).slice(0, 100);
    // // make a set of the top nodes
    // const topNodesSet = new Set(topNodesByDegree.map(d => d[0]));
    // // filter the nodes to include only the top nodes
    // nodes = nodes.filter(node => topNodesSet.has(node.id) || node.id.startsWith('rs') || node.id === centerPheno);
    // // filter the links to include only the top nodes
    // links = links.filter(link => topNodesSet.has(link.source.id) || topNodesSet.has(link.target.id) || link.source.id === centerPheno || link.target.id === centerPheno);


    if (nodeMap.has(centerPheno) && validNodes.has(centerPheno)) {
        const centerNode = nodeMap.get(centerPheno);
        centerNode.x = centerX;
        centerNode.y = centerY;
        centerNode.color = centerNode.color || 'gray';
        // fall back to the metadata the endpoint returns, in case the current
        // threshold left no rows for the centre phenotype itself
        const centerRow = data.find(d => d.phe_id === centerPheno) || centerMeta || {};
        centerNode.label = centerRow.phe_label;
        centerNode.category = centerRow.phe_cat;
    }

    return {
        nodes,
        links,
        data,
        width,
        height,
        centerX,
        centerY,
        nodeMap
    };
}


function renderNetwork(nodes, links, data, width, height, centerPheno, centerX, centerY, nodeMap, comparison_on_off = false) {
    // Clear existing network before rendering new one
    d3.select('svg').selectAll('*').remove();

    updatePanels(nodes, links);

    // Arrange RSID nodes in a circular layout
    const rsidNodes = nodes.filter(n => n.id.startsWith('rs'));
    const radius = Math.min(width, height) * 0.35;

    // Row lookups built once instead of scanning every row per node below.
    const chromByRsid = new Map();
    const pheRowById = new Map();
    for (const d of data) {
        if (!chromByRsid.has(d.rsid)) chromByRsid.set(d.rsid, d.chrom);
        if (!pheRowById.has(d.phe_id)) pheRowById.set(d.phe_id, d);
    }

    // Sort rsidNodes by chromosome
    if (!rsidNodes[0]?.x) {
        rsidNodes.forEach((node, i) => {
            node.label = node.id;
            const chromValue = chromByRsid.get(node.id);
            node.category = chromValue ? parseFloat(chromValue) : null;
        });
        rsidNodes.sort((a, b) => a.category - b.category);
        rsidNodes.forEach((node, i) => {
            const angle = (i * 2 * Math.PI) / rsidNodes.length;
            node.x = centerX + radius * Math.cos(angle);
            node.y = centerY + radius * Math.sin(angle);
        });
    }

    // Arrange phenotype nodes in a circular layout
    const pheNodes = nodes.filter(n => !n.id.startsWith('rs') && n.id !== centerPheno);

    if (!pheNodes[0]?.x) {
        const radiusPhe = Math.min(width, height) * 0.45;
        pheNodes.forEach((node, i) => {
            const row = pheRowById.get(node.id);
            node.label = row?.phe_label || node.id;
            node.category = row?.phe_cat || 'Unknown';
        });
        pheNodes.sort((a, b) => a.category.localeCompare(b.category));
        pheNodes.forEach((node, i) => {
            const angle = (i * 2 * Math.PI) / pheNodes.length;
            node.x = centerX + radiusPhe * Math.cos(angle);
            node.y = centerY + radiusPhe * Math.sin(angle);
        });
    }

    // Create SVG and set dynamic size
    const svg = d3.select('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background-color', '#252529');

    // Draw edges with color and thickness based on beta, with default opacity 0
    let pos_color = '#16faef';
    let neg_color = '#fc0339';
    if (comparison_on_off) {
        pos_color = '#32CD32';
        neg_color = '#CC5500';
    } else {
        pos_color = '#16faef';
        neg_color = '#fc0339';
    }

    // define a scaling factor that is the maximum beta divided by the diameter of the circles (which is 10)
    const maxBeta = d3.max(links, d => Math.abs(d.beta));
    const scalingFactor = 10 / maxBeta;
    
    svg.selectAll('line')
        .data(links)
        .enter()
        .append('line')
        .attr('x1', d => d.source?.x || 0) // Check for undefined source
        .attr('y1', d => d.source?.y || 0) // Check for undefined source
        .attr('x2', d => d.target?.x || 0) // Check for undefined target
        .attr('y2', d => d.target?.y || 0) // Check for undefined target
        .attr('stroke-width', d => Math.abs(d.beta) * scalingFactor + 0.5) // Scaling factor
        .attr('stroke', d => (d.direction >= 0 ? pos_color : neg_color))
        .attr('opacity', 0);

    // Draw nodes with appropriate size and color
    svg.selectAll('circle')
        .data(nodes)
        .enter()
        .append('circle')
        .attr('cx', d => d?.x || 0) // Check for undefined x
        .attr('cy', d => d?.y || 0) // Check for undefined y
        .attr('r', d => d.id === centerPheno ? 15 : (d.id.startsWith('rs') ? 5 : 8))
        .attr('fill', d => d.id === centerPheno ? nodeMap.get(centerPheno)?.color : d?.color || 'gray')
        .on('dblclick', (event, d) => {
            // if the node is not an rsid node:
            if (!d.id.startsWith('rs')) {
                // count the number of neighbors NEEDS TO BE UPDATED, technically it has to be connected to the center pheno, not just snps
                let nns = 0;
                links.forEach(l => {
                    if (l.source?.id === d.id || l.target?.id === d.id) {
                        nns++;
                    }
                });
                if (nns === 0) {
                    alert('This node is not connected to the current center phenotype under these conditions. Filters will be reset to open a new dendrogram.');
                    window.open(`page2.html?ancestry=${params.ancestry}&pvalue=${params.pvalue}&centerPheno=${d.id}`, '_blank');
                } else {
                    window.open(`page2.html?ancestry=${ancestryLower}&pvalue=${pThreshold}&centerPheno=${d.id}`, '_blank');
                }
            }
        })
        .on('click', (event, d) => {
            activeNode = d;
            highlightNode(d, links, comparison_on_off);
        })
        .on('contextmenu', function (event, d) {
            //clear any existing context menus
            d3.selectAll('.context-menu').remove();
            // Phenotype nodes only, and never the centre: an edge view of the
            // centre against itself has nothing to intersect.
            if (!d.id.startsWith('rs') && d.id !== centerPheno) {
                event.preventDefault(); // Prevent the default context menu from appearing
        
                // Create a custom context menu
                const contextMenu = d3.select('body')
                    .append('div')
                    .attr('class', 'context-menu')
                    .style('position', 'absolute')
                    .style('left', `${event.pageX}px`)
                    .style('top', `${event.pageY}px`)
                    .style('background', 'white')
                    .style('border', '1px solid #ccc')
                    .style('padding', '5px')
                    .style('z-index', 1000);
        
                // Add "Open SNP View" option to the context menu
                contextMenu.append('div')
                    .text('Open Edge View')
                    .style('cursor', 'pointer')
                    .style('padding', '5px')
                    .on('click', function () {
                        // Open sankey.html with selectedNode as leftPheno and the right-clicked node as rightPheno
                        // the edge view is out of the mask's scope, but the
                        // state rides along so it is not lost on the way
                        window.open(`page3.html?ancestry=${ancestryLower}&pvalue=${pThreshold}&leftPheno=${centerPheno}&rightPheno=${d.id}`
                                    + HierarchyMask.params());
                        contextMenu.remove(); // Remove the context menu after selection
                    });
        
                // Close the context menu when clicking outside of it
                d3.select('body').on('click.context-menu', function () {
                    contextMenu.remove();
                    d3.select('body').on('click.context-menu', null); // Remove the event listener
                });
            }
        });

    // Add labels to nodes with two lines of text
    svg.selectAll('text')
        .data(nodes)
        .enter()
        .append('text')
        .attr('x', d => d?.x || 0) // Check for undefined x
        .attr('y', d => d?.y + (d.id === centerPheno ? 20 : (d.id.startsWith('rs') ? -10 : 15)) || 0) // Check for undefined y
        .attr('text-anchor', 'middle')
        .attr('font-size', 20)
        .attr('opacity', 0)
        .style('pointer-events', 'none')
        .text(d => d.label ? `${d.label} (${d.category})` : d.id);

    // Add labels with background rectangles
    const labels = svg.selectAll('.label-group')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', 'label-group')
        .attr('opacity', 0)
        .style('pointer-events', 'none');

    labels.append('text')
        .attr('text-anchor', 'middle')
        .attr('font-size', 20)
        .text(d => d.label ? `${d.label} (${d.category})` : d.id)
        .each(function (d) {
            const bbox = this.getBBox();
            d.textWidth = bbox.width;
            d.textHeight = bbox.height;
        })
        .attr('x', d => d?.x || 0) // Check for undefined x
        .attr('y', d => d?.y + 4 || 0); // Check for undefined y

    labels.insert('rect', 'text')
        .attr('x', d => d?.x - d.textWidth / 2 - 4 || 0) // Check for undefined x
        .attr('y', d => d?.y - d.textHeight / 2 - 2 || 0) // Check for undefined y
        .attr('width', d => d.textWidth + 8)
        .attr('height', d => d.textHeight + 4)
        .attr('fill', 'white')
        .attr('opacity', 0.8)
        .attr('rx', 5).attr('ry', 5);

    // Modify hover interactions to include label groups
    svg.selectAll('circle')
        .on('mouseover', (event, d) => {
            d3.selectAll('.label-group')
                .filter(nd => nd.id === d.id)
                .transition().duration(300)
                .attr('opacity', 1);
        })
        .on('mouseout', (event, d) => {
            d3.selectAll('.label-group')
                .filter(nd => nd.id === d.id)
                .transition().duration(300)
                .attr('opacity', 0);
        });
}



