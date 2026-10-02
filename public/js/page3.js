// Global variables to store center phenotype and links
let leftPheno = null;
let rightPheno = null;
let links = [];
let pThreshold = 1e-4;
let betaThreshold = 0.01;
let betaSign = 0;
let nodes = [];
let activeNode = null;
let graphData = null;
let ancestryToggle = null;
let ancestryLower = null; // Declare ancestryLower as a global variable, and use let instead of const
let betaColumn2 = null;
let pColumn2 = null;
let pThreshold2 = 1e-4;
let comparison_on_off = false; // Variable to track if comparison mode is on
let anc1 = null;
let anc2 = null;
// Edge thickness source in comparison mode: 'a1', 'a2' or 'max' (default).
// Resets on reload because it is a plain variable, which is the specified
// behaviour.
let betaSource = 'max';


// Function to parse query parameters
function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        ancestry: params.get('ancestry'),
        // pvalue will be given in scientific notation, and we should pull the exponent. So if it is 1e-10, we should get -10
        pvalue: parseFloat(params.get('pvalue')).toExponential().split('e')[1],
        // pvalue: params.get('pvalue'),
        leftPheno: params.get('leftPheno'),
        rightPheno: params.get('rightPheno')
    };
}

const params = getQueryParams();
leftPheno = params.leftPheno;
rightPheno = params.rightPheno;

ancestryLower = params.ancestry.toLowerCase(); // Initialize ancestryLower from the query parameter
let betaColumn = `beta.${ancestryLower}`;
let pColumn = `pval.${ancestryLower}`;
// getQueryParams returns the exponent ("-4"), not the threshold itself, so
// convert here: the first request is issued before the slider initialises.
pThreshold = Math.pow(10, parseFloat(params.pvalue));

// Ask the server for the SNPs the two phenotypes share. The thresholds go
// with the request so it can skip SNPs this page would then discard and
// backfill from further down the ranking, keeping the view full whenever
// enough SNPs qualify. That makes the response depend on the sliders, so they
// re-fetch (debounced) rather than re-rendering in place.
// The nearest-gene annotation, keyed by rsID, as sent once per response in
// payload.genes. Empty against a server that predates the side map, in
// which case the pages simply draw no gene line.
let geneLookup = new Map();

function setGeneLookup(genes) {
    geneLookup = new Map();
    for (const rsid of Object.keys(genes || {})) {
        const [gene, dist, nc, pos] = genes[rsid];
        geneLookup.set(rsid, { gene: gene, dist: dist, nc: nc, pos: pos });
    }
}

async function fetchRows() {
    const params = new URLSearchParams({
        left: leftPheno,
        right: rightPheno,
        ancestry: comparison_on_off ? anc1 : ancestryLower,
        pvalue: pThreshold
    });
    // the server ranks by the weakest evidence across both ancestries, so it
    // needs to know about the second one when the cap bites
    if (comparison_on_off && anc2) {
        params.set('ancestry2', anc2);
        params.set('pvalue2', pThreshold2);
    }
    const response = await fetch(`/api/page3/rows?${params}`);
    if (!response.ok) {
        console.error('Error loading rows:', (await response.json()).error);
        return null;
    }
    const payload = await response.json();
    setGeneLookup(payload.genes);
    snpTotals = {
        shared: payload.sharedSnps,      // SNPs the two phenotypes share
        fetched: payload.shownSnps,      // how many of those the server sent
        more: payload.moreAvailable,     // were there more that qualified?
        limit: payload.limit             // the cap it applied
    };
    return payload.rows;
}

// Set by fetchRows, read by updatePanels.
let snpTotals = { shared: 0, fetched: 0, more: false, limit: 0 };

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

function updatePanels(rsidNodes, pheNodes, links, comparisonOn) {
    const drawn = rsidNodes.length;
    const { shared, more, limit } = snpTotals;

    const same = links.filter(l => l.direction >= 0).length;
    Panels.summary([
        ['SNPs', drawn],
        ['Phenotypes', pheNodes.length],
        ['Associations', links.length],
        // "concordant" and "discordant" are reserved for agreement between
        // two PHENOTYPES. In comparison mode the two sides are two
        // ancestries, so the panel says so instead of reusing the words.
        [comparisonOn ? '\u00a0\u00a0same direction' : '\u00a0\u00a0positive', same],
        [comparisonOn ? '\u00a0\u00a0opposite direction' : '\u00a0\u00a0negative',
         links.length - same],
        ['SNPs in this edge', shared]
    ]);

    // The server reports directly whether more SNPs cleared the filters than
    // fit on screen, so the warning no longer has to infer it.
    Panels.snpWarning(limit, more);
}

async function loadData() {
    let data;
    try {
        data = await fetchRows();
    } catch (error) {
        console.error('Error loading rows:', error);
        return null;
    }
    if (!data) return null;

    try {
        console.log('Number of rows (combined):', data.length);
        // // if commonRSIDs is longer than 100, sort by chrom and take 100 evenly spaced values
        // if (commonRSIDs.length > 100) {
        //     // sort commonRSIDs by chrom
        //     commonRSIDs.sort((a, b) => {
        //         const chromA = data.find(d => d.rsid === a).chrom;
        //         const chromB = data.find(d => d.rsid === b).chrom;
        //         return chromA - chromB;
        //     }
        //     );
        //     // take every nth value, where n is the length of commonRSIDs divided by 100
        //     const n = Math.ceil(commonRSIDs.length / 100);
        //     const filteredRSIDs = [];
        //     for (let i = 0; i < commonRSIDs.length; i += n) {
        //         filteredRSIDs.push(commonRSIDs[i]);
        //     }
        //     // set commonRSIDs to the filteredRSIDs
        //     commonRSIDs.length = 0; // Clear the original array
        //     commonRSIDs.push(...filteredRSIDs); // Add the filtered values
        // }
        // console.log('Number of common rsids:', commonRSIDs.length);

        // the shared-SNP restriction and the left/right phenotype filter are
        // both applied server-side now
        // if the data is empty, warn the user and then close the window
        if (data.length === 0) {
            alert('No data found for the selected phenotypes.');
            window.close();
        }


        return data; // Return the data after loading
    } catch (error) {
        console.error(`Error loading file:`, error);
        return null; // Return null in case of an error
    }
}

// Re-render from the rows already loaded. The p-value sliders use this.
function redraw() {
    if (!graphData) {
        console.warn('Data is not loaded yet.');
        return;
    }

    const network = initializeNetwork(graphData, betaColumn, pColumn, betaColumn2, pColumn2, comparison_on_off);
    nodes = network.nodes;
    links = network.links;
    const filteredEdges = updateEdges(pThreshold, betaThreshold, betaSign, network.links, graphData, pThreshold2, comparison_on_off);
    const { nodes: filteredNodes, edges: filteredLinks } = updateNodes(filteredEdges, network.nodes);
    renderNetwork(filteredNodes, filteredLinks, graphData, network.width, network.height, leftPheno, rightPheno, network.nodeMap, comparison_on_off);
}

// Changing the ancestry changes the ranking used for the cap, so that needs a
// round trip; everything else redraws locally.
async function refresh() {
    let rows;
    try {
        rows = await fetchRows();
    } catch (error) {
        console.error('Error loading rows:', error);
        return;
    }
    if (!rows) return;
    graphData = rows;
    redraw();
}

// Call the async function and use the data when it's ready
loadData().then(async (data) => {
    if (data) {
        graphData = data;

        // Ancestries with data for BOTH phenotypes, answered by the server
        // against the unfiltered table.
        const ORDER = ['amr', 'eas', 'afr', 'eur', 'meta'];
        let base_ancestries = ORDER.slice();
        try {
            const [left, right] = await Promise.all([
                fetch(`/api/node/${leftPheno}/ancestries`).then(r => r.json()),
                fetch(`/api/node/${rightPheno}/ancestries`).then(r => r.json())
            ]);
            base_ancestries = ORDER.filter(
                a => left.ancestries.includes(a) && right.ancestries.includes(a)
            );
        } catch (error) {
            console.error('Error loading ancestry availability:', error);
        }

        // Define the log scale range
        const minLogP = -12; // Corresponding to 10^-12
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
                <input type="range" id="pvalue-slider" name="pvalue-slider" min="${minLogP}" max="${maxLogP}" step="0.1" value="${maxLogP}">
                <input type="number" id="pvalue-input" step="0.1" min="${minLogP}" max="${maxLogP}" value="${maxLogP}">
                <span id="pvalue-threshold">1e${maxLogP}</span>
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
        // .append('div')
        // .style('position', 'absolute')
        // .style('top', '150px')
        // .style('left', '10px')
        // .style('background', 'transparent')
        // .style('padding', '10px')
        // .style('color', 'white')
        // .html(`
        //     <label for="beta-threshold-slider">Select beta threshold:</label>
        //     <input type="range" id="beta-threshold-slider" name="beta-threshold-slider" min="0" max="1" step="0.01" value="0">
        //     <input type="number" id="beta-input" step="0.01" min="0" max="1" value="0">
        //     <span id="beta-threshold">0</span>
        // `);

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
        //     nodes = network.nodes;
        //     links = network.links;
        //     const filteredEdges = updateEdges(pThreshold, betaThreshold, betaSign, network.links, graphData);
        //     const { nodes: filteredNodes, edges: filteredLinks } = updateNodes(filteredEdges, network.nodes);

        //     renderNetwork(filteredNodes, filteredLinks, graphData, network.width, network.height, leftPheno, rightPheno, network.nodeMap, comparison_on_off);

        // }, 200); // 200ms debounce delay
        // };

        // // Initialize the slider and input with the value from the query parameter
        // const initialBeta = 0.0;
        // d3.select('#beta-threshold-slider').property('value', initialBeta);
        // d3.select('#beta-input').property('value', initialBeta);
        // updateBetaThreshold(initialBeta);
        // d3.select('#beta-threshold').text(betaThreshold);

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
        .text('About SNP View')
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
            <h2>SNP View</h2>
            <p>The nodes on the left and right are the two phenotypes you selected.
            The nodes down the middle are the SNPs associated with both of them,
            colored and ordered by the chromosome they sit on, which also appears in
            the label when you hover over one.</p>

            <p>Pairs of phenotypes can share thousands of SNPs, more than this layout
            can show, so the view is limited to the 250 with the strongest evidence,
            ranked by z-score (the effect size divided by its standard error). The
            note at the bottom left says so whenever more SNPs qualify than fit, and
            "Download Data" returns every shared SNP rather than just those on
            screen.</p>

            <p>Nearest gene is the closest protein-coding gene by genomic position (GRCh38, TxDb.Hsapiens.UCSC.hg38.knownGene 3.22.0 with org.Hs.eg.db 3.23.1) and does not indicate the causal gene. Inside the extended MHC (chr6:25726777-33409896) the gene is replaced by "MHC region", because genes there are packed too densely and linkage disequilibrium runs too far for a nearest gene to mean much.</p>

            <h3>Reading the links</h3>
            <p>Links are colored by the direction of the association and given a
            thickness based on the effect size.</p>

            <p>Selecting a second ancestry switches to a comparison: only SNPs
            significant in both are kept, and links turn green where the
            association runs in the same direction across ancestries and orange
            where it runs in the opposite direction across ancestries. These are
            not the concordant and discordant labels used elsewhere, which
            compare two phenotypes rather than two ancestries.
            The two p-value thresholds move independently, SNPs are ranked by whichever
            ancestry supports them less, and the edge thickness control chooses which
            ancestry's effect size sets the width.</p>

            <h3>Exploring</h3>
            <p>Double-click a phenotype to open its Phenotype view. The panel at the
            bottom left counts what is currently drawn.</p>
        `);

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
                        highlightNode(node);
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

        // add a download button to download data as a csv file
        // const downloadButton = infoContainer.append('button')
        //     .text('Download Data')
        //     .style('display', 'block')
        //     .style('margin-top', '10px')
        //     .style('background', '#444')
        //     .style('color', 'white')
        //     .style('border', 'none')
        //     .style('padding', '8px 12px')
        //     .style('cursor', 'pointer')
        //     .style('border-radius', '5px')
        //     .on('click', () => {
        //         const csvString = d3.csvFormat(graphData);
        //         const blob = new Blob([csvString], { type: 'text/csv' });
        //         const url = URL.createObjectURL(blob);
        //         const a = document.createElement('a');
        //         a.href = url;
        //         a.download = 'data.csv';
        //         document.body.appendChild(a);
        //         a.click();
        //         document.body.removeChild(a);
        //     });

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
            // Assume graphData is the object returned by initializeNetwork
            // It contains {nodes, links, data, width, height, nodeMap}
            // Every shared SNP, not just the ones on screen, which is what the
            // cap warning promises. Served as CSV by the API.
            window.location.href = `/api/page3/download?left=${encodeURIComponent(leftPheno)}` +
                                   `&right=${encodeURIComponent(rightPheno)}`;
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
        // Hand-written offsets collided once the ancestry list and the edge
        // thickness radios stacked up under each other. Lay the column out
        // from measured heights, with the search bar last. (No reset button
        // here: page 3 holds no selection to clear.)
        const stack = () => Panels.stackLeft([
            pValueSlider.node(),
            pValueSlider2.node(),
            compareAncestries.node(),
            document.getElementById('gene-labels-container'),
            searchContainer.node()
        ].filter(Boolean));
        stack();

        GeneLabels.readParams(new URLSearchParams(window.location.search));
        GeneLabels.control(redraw);
        stack();
        if (GeneLabels.enabled) redraw();

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

                ancestryLower = checked[0].value.toLowerCase(); // Update ancestryLower when the selection changes
                console.log(`Ancestry selected: ${ancestryLower}`);
                betaColumn = `beta.${ancestryLower}`;
                pColumn = `pval.${ancestryLower}`;
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
            nodes = network.nodes;
            links = network.links;
            const filteredEdges = updateEdges(pThreshold, betaThreshold, betaSign, network.links, graphData);
            const { nodes: filteredNodes, edges: filteredLinks } = updateNodes(filteredEdges, network.nodes);
            renderNetwork(filteredNodes, filteredLinks, graphData, network.width, network.height, leftPheno, rightPheno, network.nodeMap, comparison_on_off);
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

/**
 * The hover label's second line for a SNP: its nearest gene.
 *
 * Always says "Nearest gene", never "gene". The annotation is the closest
 * protein-coding gene by position; it is not a causal assignment and the
 * wording has to keep saying so.
 *
 * Returns '' for a phenotype node or an unannotated SNP, and the caller
 * skips the line entirely rather than drawing an empty one.
 */
function nearestGeneLine(d) {
    if (!d || !d.nearestGene || !String(d.id).startsWith('rs')) return '';
    // the MHC string already carries its own "nearest", so prefixing it
    // again reads "Nearest gene: MHC region (nearest: H4C3)"
    if (d.nearestGene.startsWith('MHC region')) {
        return d.nearestGene.replace('nearest:', 'nearest gene:');
    }
    return `Nearest gene: ${d.nearestGene}`;
}

/**
 * A second tooltip line naming the non-coding gene a SNP sits inside, when
 * it does. Secondary on purpose: the headline label stays protein-coding so
 * it agrees with the paper, while a reader looking at, say, rs198851 can
 * still see it is inside HFE-AS1 rather than only that the nearest coding
 * gene is 66 bp away.
 */
function overlappingNoncodingLine(d) {
    if (!d || !d.overlappingNoncoding || !String(d.id).startsWith('rs')) return '';
    const all = String(d.overlappingNoncoding).split('|');
    const shown = all[0] + (all.length > 1 ? ` +${all.length - 1}` : '');
    return `Within: ${shown} (non-coding)`;
}


function updateNodes(edges, nodes) {
    // Same result as before, but in two passes over the edges instead of
    // scanning them once per node (and, for the phenotypes, once per node per
    // SNP). On a large edge view that nested form was ~1e9 comparisons.

    // degree per node id; an edge counts once for a node even if it happens to
    // sit on both of its ends, matching the original `source || target` test
    const degree = new Map();
    const bump = id => degree.set(id, (degree.get(id) || 0) + 1);
    for (const edge of edges) {
        const s = edge.source.id;
        const t = edge.target.id;
        bump(s);
        if (t !== s) bump(t);
    }

    // find all the nodes that have ids starting with rs
    const rsidNodes = nodes.filter(node => node.id.startsWith('rs'));
    // eliminate any rsid nodes that have less than 2 edges
    const rsidNodesFiltered = rsidNodes.filter(node => (degree.get(node.id) || 0) >= 2);
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


// Function to highlight a selected node for 5 seconds
function highlightNode(activeNodeId) {
    const svg = d3.select('svg');
    console.log(activeNodeId)

    // Select the label group corresponding to the active node
    const labelGroup = svg.selectAll('.label-group')
        .filter(d => d.id === activeNodeId.id);

    // Make it visible
    labelGroup.transition()
        .duration(200)
        .attr('opacity', 1);

    // Fade out after 5 seconds
    setTimeout(() => {
        labelGroup.transition()
            .duration(1000) // fade out duration
            .attr('opacity', 0);
    }, 5000);
}
// A p-value of exactly 0 is the strongest possible association. The previous
// `parseFloat(p) || 1` idiom coerced it to 1 and silently dropped those rows;
// only a missing value should fall back to 1.
function toPvalue(value) {
    const p = parseFloat(value);
    return Number.isFinite(p) ? p : 1;
}

function initializeNetwork(data, betaColumn, pColumn, betaColumn2=null, pColumn2=null, comparison_on_off=false) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;
    console.log('data:', data);
    // One row per (SNP, phenotype). Duplicated pairs otherwise draw twice,
    // and in comparison mode the two copies can disagree about direction -
    // see public/js/rows.js.
    data = Rows.dedupeRows(data, pColumn, comparison_on_off ? pColumn2 : null);

    const nodeMap = new Map();
    data.forEach(d => {
        if (!nodeMap.has(d.rsid)) nodeMap.set(d.rsid, { id: d.rsid, color: d.rsid_hex });
        if (!nodeMap.has(d.phe_id)) nodeMap.set(d.phe_id, { id: d.phe_id, color: d.phe_hex });
    });
    console.log('Number of nodes:', nodeMap.size);

    let links = data
    .map(d => {
        const betaValue = parseFloat(d[betaColumn]);
        if (isNaN(betaValue)) return null; // Exclude links with NaN beta

        return {
            source: nodeMap.get(d.rsid),
            target: nodeMap.get(d.phe_id),
            beta: Math.abs(betaValue),
            direction: Math.sign(betaValue) || 0,
            pvalue: toPvalue(d[pColumn])
        };
    })
    .filter(link => link !== null); // Remove null entries
    console.log('Number of links:', links.length);

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

    // filter out edges that have a nan beta value
    links = links.filter(l => !isNaN(l.beta));

    // Identify nodes that only have NaN beta edges 
    // NOTE these next two blocks should be redundant but I'm not messing with them for now
    const nodeEdgeMap = new Map();
    links.forEach(link => {
        if (!nodeEdgeMap.has(link.source.id)) nodeEdgeMap.set(link.source.id, []);
        if (!nodeEdgeMap.has(link.target.id)) nodeEdgeMap.set(link.target.id, []);
        nodeEdgeMap.get(link.source.id).push(link.beta);
        nodeEdgeMap.get(link.target.id).push(link.beta);
    });

    const validNodes = new Set();
    nodeEdgeMap.forEach((betas, nodeId) => {
        if (betas.some(beta => !isNaN(beta))) {
            validNodes.add(nodeId);
        }
    });

    // Filter nodes and links to remove those only connected by NaN beta edges
    let nodes = Array.from(nodeMap.values()).filter(node => validNodes.has(node.id));
    links = links.filter(link => validNodes.has(link.source.id) && validNodes.has(link.target.id));

    // check rsid nodes to make sure they have non-NaN edges to both left and right phenotypes
    const rsidNodes = nodes.filter(n => n.id.startsWith('rs'));
    const rsidNodeMap = new Map();
    rsidNodes.forEach(n => rsidNodeMap.set(n.id, { left: false, right: false }));

    // Distinct phenotypes per SNP, in one pass over the links. Scanning every
    // link for every SNP was ~1e9 comparisons on a large edge view.
    //
    // Note the >= 2 test below never actually rejects anything: the seed value
    // above is an object, which is truthy, so the filter that reads this map
    // keeps every SNP either way. Left as-is because updateNodes() enforces the
    // same "at least two edges" rule on the thresholded edges, which is the one
    // that matters.
    const phenotypesPerRsid = new Map();
    const note = (rsid, pheno) => {
        let seen = phenotypesPerRsid.get(rsid);
        if (!seen) phenotypesPerRsid.set(rsid, seen = new Set());
        seen.add(pheno);
    };
    for (const link of links) {
        const s = link.source.id;
        const t = link.target.id;
        if (rsidNodeMap.has(s) && !t.startsWith('rs')) note(s, t);
        if (rsidNodeMap.has(t) && !s.startsWith('rs')) note(t, s);
    }
    rsidNodes.forEach(rsNode => {
        if ((phenotypesPerRsid.get(rsNode.id)?.size || 0) >= 2) {
            rsidNodeMap.set(rsNode.id, true);
        }
    });

    // Extract valid RSID nodes
    const validRSIDNodes = rsidNodes.filter(n => rsidNodeMap.get(n.id));
    
    const validRSIDNodeIds = new Set(validRSIDNodes.map(n => n.id));
    // filter the nodes to include nodes that are in validRSIDNodeIds or DO NOT start with rs
    nodes = nodes.filter(n => validRSIDNodeIds.has(n.id) || !n.id.startsWith('rs'));
    links = links.filter(l => validRSIDNodeIds.has(l.source.id) || validRSIDNodeIds.has(l.target.id));

    return {
        nodes,
        links,
        data,
        width,
        height,
        nodeMap
    };
}



function renderNetwork(nodes, links, data, width, height, leftPheno, rightPheno, nodeMap, comparison_on_off = false) {
    // Clear existing network before rendering new one
    d3.select('svg').selectAll('*').remove();

    // Arrange RSID nodes in line down the middle of the screen
    let rsidNodes = nodes.filter(n => n.id.startsWith('rs'));

    // Link counts per node in one pass; the filters below then use set
    // lookups. Each of these steps used to rescan every link or every SNP,
    // which on a large edge view is around 1e9 comparisons apiece.
    const linkCount = new Map();
    for (const l of links) {
        linkCount.set(l.source.id, (linkCount.get(l.source.id) || 0) + 1);
        linkCount.set(l.target.id, (linkCount.get(l.target.id) || 0) + 1);
    }

    // sort rsidNodes by chromosome
    // remove any nodes have less than 2 links
    rsidNodes = rsidNodes.filter(n => (linkCount.get(n.id) || 0) >= 2);
    const rsidIds = new Set(rsidNodes.map(n => n.id));

    // remove links that are not in rsidNodes
    links = links.filter(l => rsidIds.has(l.source.id) || rsidIds.has(l.target.id));

    // filter nodes to only include those that are in rsidNodes or nodes that do not start with rs
    nodes = nodes.filter(n => rsidIds.has(n.id) || !n.id.startsWith('rs'));

    // chromosome per rsid, looked up once rather than scanning every data row
    const chromByRsid = new Map();
    // the annotation arrives once per SNP in payload.genes, not on each
    // row; geneLookup is set by fetchRows and is empty if the server
    // predates the side map
    const geneByRsid = geneLookup;
    for (const d of data) {
        if (!chromByRsid.has(d.rsid)) chromByRsid.set(d.rsid, d.chrom);

    }

    rsidNodes.forEach((node, i) => {
        // add a label
        node.label = node.id;
        // add an attribute called chromosome that comes from the chrom column in the data
        const chromValue = chromByRsid.get(node.id);
        node.category = chromValue ? parseFloat(chromValue) : null;
        const g = geneByRsid.get(node.id);
        node.nearestGene = g ? g.gene : null;
        node.geneDistanceBp = g ? g.dist : null;
        node.overlappingNoncoding = g ? g.nc : null;
        node.grch38Pos = g && g.pos != null ? Number(g.pos) : null;
        });
    // Order by chromosome and then by position on it. Chromosome alone
    // left SNPs sharing a nearest gene scattered around the ring, so a
    // run-based gene label fragmented - ESRD in AFR drew five separate
    // MYH9 brackets. SNPs with no position sort last within their
    // chromosome rather than disturbing the ones that have one.
    rsidNodes.sort((a, b) => (a.category - b.category)
        || ((a.grch38Pos == null) - (b.grch38Pos == null))
        || ((a.grch38Pos || 0) - (b.grch38Pos || 0)));
        const middle_x = width / 2;
        rsidNodes.forEach((node, i) => {
            node.x = middle_x;
            node.y = (i + 1) * height / (rsidNodes.length + 1);
    });
    updatePanels(rsidNodes, nodes.filter(n => !n.id.startsWith('rs')), links, comparison_on_off);

    // Arrange phenotype nodes
    const middle_y = height / 2;
    const left_x = width / 5;
    const right_x = width * 4 / 5;

    // make a variable called leftNode that is the node with the id leftPheno
    const leftNode = nodes.find(n => n.id === leftPheno);
    const rightNode = nodes.find(n => n.id === rightPheno);

    // Nothing clears the filters: leave the canvas empty. The counts and the
    // warning have already been written above, so the page still explains
    // itself. Previously this fell through to `leftNode[0]`, which threw on
    // undefined and left a blank page with only a console error.
    if (!leftNode || !rightNode) return;

    if (leftNode.x === undefined) {
        // set the x and y attributes of the leftNode
        leftNode.x = left_x;
        leftNode.y = middle_y;
        rightNode.x = right_x;
        rightNode.y = middle_y;

        // assign colors and categories to the nodes
        leftNode.color = leftNode.id === leftPheno ? nodeMap.get(leftPheno).color : leftNode.color || 'gray';
        rightNode.color = rightNode.id === rightPheno ? nodeMap.get(rightPheno).color : rightNode.color || 'gray';
        leftNode.label = data.find(d => d.phe_id === leftPheno).phe_label;
        rightNode.label = data.find(d => d.phe_id === rightPheno).phe_label;
        leftNode.category = data.find(d => d.phe_id === leftPheno).phe_cat;
        rightNode.category = data.find(d => d.phe_id === rightPheno).phe_cat;
    }

    // Create SVG and set dynamic size
    const svg = d3.select('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background-color', '#252529');

    // make a const called maxBeta that is the maximum beta value in the links array
    const maxBeta = d3.max(links, d => Math.abs(d.beta));
    const scalingFactor = 10 / maxBeta;

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

    // Draw edges with color and thickness based on beta, with default opacity 0
    svg.selectAll('line')
        .data(links)
        .enter()
        .append('line')
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y)
        .attr('stroke-width', d => Math.abs(d.beta) * scalingFactor)
        .attr('stroke', d => (d.direction >= 0 ? pos_color : neg_color))
        .attr('opacity', 1);


    // Draw nodes with appropriate size and color
    svg.selectAll('circle')
        .data(nodes)
        .enter()
        .append('circle')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        // set the radius to be 3 if the id starts with rs, and 10 otherwise
        .attr('r', d => d.id.startsWith('rs') ? 5 : 10)
        .attr('fill', d => d.color || 'gray')
        // on double click open dendrogram.html in a new tab with the double clicked node as the center node, using the current pvalue and ancestry
        .on('dblclick', (event, d) => {
            // if the node is not an rsid, open the dendrogram
            if (!d.id.startsWith('rs')) {
            window.open(`page2.html?centerPheno=${d.id}&pvalue=${pThreshold}&ancestry=${ancestryLower}`, '_blank');
            }
        });


    // Add labels to nodes with two lines of text
    svg.selectAll('text')
        .data(nodes)
        .enter()
        .append('text')
        .attr('x', d => d.x)
        .attr('y', d => d.y + (d.id.startsWith('rs') ? -10 : 15))
        .attr('text-anchor', 'middle')
        .attr('font-size', 20)
        .attr('opacity', 0)
        .style('pointer-events', 'none')
        .text(d => d.label ? `${d.label}\n(${d.category})` : d.id);

    // Define font size for measurement consistency
    const fontSize = 20;

    // Add labels with background rectangles
    const labels = svg.selectAll('.label-group')
        .data(nodes)
        .enter()
        .append('g')
        .attr('class', 'label-group')
        .attr('opacity', 0)  // Initially hidden
        .style('pointer-events', 'none'); // Ensures labels don’t block interactions

    // Add text elements
    labels.append('text')
        .attr('text-anchor', 'middle')
        .attr('font-size', fontSize)
        .each(function (d) {
            // two lines for an annotated SNP, one for everything else
            const head = d.label ? `${d.label}\n(${d.category})` : d.id;
            const gene = nearestGeneLine(d);
            const nc = overlappingNoncodingLine(d);
            const extra = [gene, nc].filter(Boolean);
            const t = d3.select(this);
            t.append('tspan').attr('x', d?.x || 0)
                .attr('dy', extra.length ? `${-0.45 * extra.length}em` : '0').text(head);
            extra.forEach(line => {
                t.append('tspan').attr('x', d?.x || 0).attr('dy', '1.15em')
                    .attr('font-size', Math.max(10, fontSize - 4))
                    .attr('fill', '#333').text(line);
            });
        })
        .each(function (d) {
            const bbox = this.getBBox(); // Get text size
            d.textWidth = bbox.width;
            d.textHeight = bbox.height;
        })
        .attr('x', d => d.x)
        .attr('y', d => d.y + 4); // Adjust for centering

    // Add background rectangles
    labels.insert('rect', 'text')
        .attr('x', d => d.x - d.textWidth / 2 - 4) // Center and add padding
        .attr('y', d => d.y - d.textHeight / 2 - 2)
        .attr('width', d => d.textWidth + 8)
        .attr('height', d => d.textHeight + 4)
        .attr('fill', 'white')
        .attr('opacity', 0.8)
        .attr('rx', 5).attr('ry', 5); // Rounded corners

    // Stage 2 group labels, drawn only while the toggle is on.
    GeneLabels.drawColumn(svg, nodes.filter(n => String(n.id).startsWith('rs')), {});

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

