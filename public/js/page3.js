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

// Ask the server for the SNPs the two phenotypes share. The response depends
// only on the ancestry (which decides the ranking when the set is capped), so
// moving either p-value slider re-renders from the rows already in hand.
async function fetchRows() {
    const params = new URLSearchParams({
        left: leftPheno,
        right: rightPheno,
        ancestry: comparison_on_off ? anc1 : ancestryLower
    });
    // the server ranks by the weakest p-value across both ancestries, so it
    // needs to know about the second one when the cap bites
    if (comparison_on_off && anc2) params.set('ancestry2', anc2);
    const response = await fetch(`/api/page3/rows?${params}`);
    if (!response.ok) {
        console.error('Error loading rows:', (await response.json()).error);
        return null;
    }
    const payload = await response.json();
    snpTotals = { shared: payload.sharedSnps, fetched: payload.shownSnps };
    return payload.rows;
}

// How many SNPs the two phenotypes share, and how many of those were fetched
// (the server caps very large edges). Set by fetchRows, read by showSnpCount.
let snpTotals = { shared: 0, fetched: 0 };

// Report what is actually on screen. Two separate things cut the number down:
// the p-value filters, and the server-side cap on very large edges. Say so
// rather than quietly truncating.
function showSnpCount(drawn) {
    let box = d3.select('#snp-count');
    if (box.empty()) {
        box = d3.select('body').append('div')
            .attr('id', 'snp-count')
            .style('position', 'absolute')
            .style('bottom', '10px')
            .style('left', '10px')
            .style('font-size', '13px')
            .style('pointer-events', 'none');
    }
    const { shared, fetched } = snpTotals;
    const capped = fetched < shared;
    box.style('color', capped ? '#ffcc66' : 'white').text(
        capped
            ? `${drawn.toLocaleString()} SNPs drawn \u2014 view is capped at the ` +
              `${fetched.toLocaleString()} most significant of ${shared.toLocaleString()} ` +
              `shared; loosening the filters will not show more than that`
            : `${drawn.toLocaleString()} of ${shared.toLocaleString()} shared ` +
              `SNP${shared === 1 ? '' : 's'} drawn`);
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

                redraw();

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
                redraw();
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
        .style('display', 'none')
        .style('margin-top', '10px') 
        .style('padding', '10px')
        .style('background', 'rgba(0, 0, 0, 0.8)')
        .style('border-radius', '5px')
        .style('max-width', '600px')
        .html(`
            <h2>SNP View</h2>
            <p>
                The nodes on the left and right are the phenotypes you selected.</p>
            <p>The nodes in the middle are the SNPs associated with both phenotypes.<br>
                These nodes are colored and ordered by the chromosome they are located on. <br>
                The chromosome also appears in the label when hovering over the node.</p>
            <p>The edges are colored based on the direction of their association, and given<br>
                a thickness based on the effect size.</p>
            <p>Selecting a second ancestry re-colors the links so that they are green if the association is the same
                direction in both ancestries, and orange if they are different directions. The p-values can be toggled independently for 
                the two ancestries</p>
            <p>Double click a phenotype to enter its node view.</p>
            </p>
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
            const exportdata = network;

            // Create a filtered array of rows from data corresponding to links in the current network
            const linkSet = new Set(exportdata.links.map(l => `${l.source.id}|${l.target.id}`));
            const filteredData = data.filter(d => linkSet.has(`${d.rsid}|${d.phe_id}`));

            // Convert filteredData to CSV
            const csvString = d3.csvFormat(filteredData);

            // Trigger download
            const blob = new Blob([csvString], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'network_data.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
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
            `);

        const checkbox = document.querySelector(`#chk-${ancestryLower}`);
        console.log(checkbox);
        if (checkbox) {
            // Only reflect the query string in the UI. Dispatching 'change' here
            // re-fetched and re-rendered the entire graph on top of the initial
            // render below, doubling load time on large views.
            checkbox.checked = true;
        }

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
                link.beta = Math.max(link.beta, match.beta); // Use max beta
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
    for (const d of data) {
        if (!chromByRsid.has(d.rsid)) chromByRsid.set(d.rsid, d.chrom);
    }

    rsidNodes.forEach((node, i) => {
        // add a label
        node.label = node.id;
        // add an attribute called chromosome that comes from the chrom column in the data
        const chromValue = chromByRsid.get(node.id);
        node.category = chromValue ? parseFloat(chromValue) : null;
        });
    rsidNodes.sort((a, b) => a.category - b.category);
        const middle_x = width / 2;
        rsidNodes.forEach((node, i) => {
            node.x = middle_x;
            node.y = (i + 1) * height / (rsidNodes.length + 1);
    });
    showSnpCount(rsidNodes.length);
    
    // Arrange phenotype nodes 
    const middle_y = height / 2;
    const left_x = width / 5;
    const right_x = width * 4 / 5;

    // make a variable called leftNode that is the node with the id leftPheno
    const leftNode = nodes.find(n => n.id === leftPheno);
    const rightNode = nodes.find(n => n.id === rightPheno);

    if (leftNode[0]?.x) {
        // if they do, do nothing
        
    }
    else {
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
        .text(d => d.label ? `${d.label}\n(${d.category})` : d.id)
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

