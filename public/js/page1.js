let nodes;
let links;
let ancestry = 'meta'; // Default ancestry
let pvalue = '1e-04'; // Default p-value
let edgeType = 'weight'; // Default edge type

// Floor for drawn edge width, in the same units as the scaled edge weights.
// The weights span four orders of magnitude - under the default filters the
// thinnest present edge is 0.001 against a maximum of 50.9 - so the bottom
// of the range rendered at a few thousandths of a pixel and was invisible,
// which made a real edge look like no edge at all.
//
// Calibrated to the edge between Other aneurysm and Other abnormal glucose
// under the default filters (META, 1e-04, total weight), which is the
// thinnest edge still comfortably readable on screen. Anything below it is
// drawn at this width instead.
const MIN_STROKE_WIDTH = 0.083;

// The hierarchy-mask toggle carries over from a page that opened this one,
// the same way ancestry and pvalue would; absent means off.
HierarchyMask.readParams(new URLSearchParams(window.location.search));

document.addEventListener('DOMContentLoaded', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Create an SVG element
    const svg = d3.select('body')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('background-color', '#252529');  // Set background color to black

    // Create a group <g> element to contain all nodes and links
    const content = svg.append('g');

    // Node attributes are static; edge weights come back already narrowed to
    // the selected ancestry/p-value instead of the full 92-column table.
    Promise.all([
        fetch(`/api/landing/edges?ancestry=${ancestry}&pvalue=${pvalue}` +
              (HierarchyMask.needsEdgeRel() ? '&rel=1' : '')).then(r => r.json()),
        fetch('/api/landing/nodes').then(r => r.json())
    ]).then(([edgeResponse, nodeResponse]) => {
        // Degree per node under the active filters. Computed here rather than
        // taken from the server's copy because it has to respect the edge type
        // as well: with "Concordant" selected, a phenotype whose edges are all
        // discordant has no edges on screen.
        let degrees = {};
        let degreeThreshold = 0;

        // A masked edge is treated as absent rather than merely invisible.
        // Everything downstream - computeDegrees, the slider range, the
        // isolate drop in updateFilter, the drawn edges and the summary
        // counts - already keys off this one predicate, so the degree filter
        // is the masked degree with no second code path.
        function edgePresent(l) {
            if (HierarchyMask.isMasked(l.source, l.target, l.rel)) return false;
            if (edgeType === 'same_dir_weight') return (l.same || 0) !== 0;
            if (edgeType === 'diff_dir_weight') return (l.diff || 0) !== 0;
            return (l.same || 0) !== 0 || (l.diff || 0) !== 0;
        }

        function computeDegrees() {
            const d = {};
            for (const l of links) {
                if (!(l.source in d)) d[l.source] = 0;
                if (!(l.target in d)) d[l.target] = 0;
                if (edgePresent(l)) { d[l.source]++; d[l.target]++; }
            }
            return d;
        }

        // The slider's range is only meaningful against the degrees actually
        // in play: the largest is 541 under META at 1e-04 but 5 under EAS, so
        // a fixed range left most of the track doing nothing.
        function syncDegreeSlider() {
            const max = Math.max(1, d3.max(Object.values(degrees)) || 1);
            if (degreeThreshold > max) degreeThreshold = max;
            d3.select('#degree-slider').attr('max', max).property('value', degreeThreshold);
            d3.select('#degree-input').attr('max', max).property('value', degreeThreshold);
            d3.select('#degree-value').text(degreeThreshold);
        }

        nodes = nodeResponse.nodes.map(d => ({
            id: d.id,
            x: +d.x,
            y: +d.y,
            size: +d.size,
            label: d.label,
            color: d.hex,
            hex: d.hex,
            category: d.category,
            degree: +d.degree
        }));

        const nodeMap = new Map(nodes.map(node => [node.id, node]));

        function getNodeById(id) {
            return nodeMap.get(id);
        }
        
        // Each link carries only the two weights for the active filter
        // (`same`/`diff`); changing the filter refreshes them in place so the
        // d3 data binding below stays valid.
        links = edgeResponse.edges;

        // Precompute node neighbors
        const nodeNeighborsMap = new Map();

        nodes.forEach(node => {
            nodeNeighborsMap.set(node.id, []);
        });

        links.forEach(link => {
            nodeNeighborsMap.get(link.source).push(link.target);
            nodeNeighborsMap.get(link.target).push(link.source);
        });

        // Add a container for the search bar
        const searchContainer = d3.select('body')
            .append('div')
            .attr('id', 'search-bar-container')
            .style('position', 'absolute')
            .style('top', '400px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white');

        searchContainer.html(`
            <input type="text" id="node-search" placeholder="Search node..." style="width: 180px; padding: 5px;">
            <div id="search-results" style="background: #222; color: white; margin-top: 2px; max-height: 150px; overflow-y: auto; display: none;"></div>
        `);


        // Initialize the slider here
        const degreeFilterContainer = d3.select('body')
            .append('div')
            .style('position', 'absolute')
            .style('top', '10px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white')
            .html(`
                <div>
                    <label for="degree-slider">Filter by Node Degree:</label>
                </div>
                <input id="degree-slider" type="range" min="0" max="${d3.max(nodes, d => d.degree)}" step="1" value="0">
                <input id="degree-input" type="number" min="0" max="${d3.max(nodes, d => d.degree)}" step="1" value="0" 
                    style="width: 60px; margin-left: 10px;">
                <span id="degree-value">0</span>
            `);

        // Event handler for the slider
        d3.select('#degree-slider').on('input', function () {
            degreeThreshold = +this.value;
            d3.select('#degree-input').property('value', degreeThreshold);
            d3.select('#degree-value').text(degreeThreshold);
            updateFilter();
        });

        // Event handler for the input box
        d3.select('#degree-input').on('input', function () {
            degreeThreshold = +this.value;
            d3.select('#degree-slider').property('value', degreeThreshold);
            d3.select('#degree-value').text(degreeThreshold);
            updateFilter();
        });

        /**
         * Apply the degree threshold.
         *
         * Degree means degree *under the current filters*, not the static
         * column in node_attributes. That column counts every edge the
         * phenotype has under any filter combination, so the slider used to
         * act on a number unrelated to what was on screen, and the phenotype
         * count never moved when the ancestry or p-value changed.
         *
         * A phenotype with no surviving edges is dropped even at threshold 0:
         * it is an isolate under these filters and is not part of the network
         * being shown. Under EAS at 1e-04 that is most of them - 71 of 1,321
         * phenotypes have an edge at all.
         */
        function updateFilter() {
            const minDegree = Math.max(1, degreeThreshold);
            filteredNodes = nodes.filter(n => (degrees[n.id] || 0) >= minDegree);

            // Membership is tested once per link and once per node below; as a
            // linear scan of filteredNodes that was ~72M comparisons a keystroke.
            filteredNodeIds = new Set(filteredNodes.map(n => n.id));

            // An edge counts only if it carries weight under the active edge
            // type; the rest are "ghost edges" that would draw at zero width.
            filteredLinks = links.filter(l =>
                edgePresent(l) &&
                filteredNodeIds.has(l.source) &&
                filteredNodeIds.has(l.target)
            );
            filteredLinkSet = new Set(filteredLinks);

            // Update node opacity to reflect filtering
            node.style('opacity', n => filteredNodeIds.has(n.id) ? 1 : 0.2);

            // Call highlightNode to reapply the node highlighting logic
            if (activeNode) highlightNode(activeNode);
            updateSummary();
        }


        /**
         * Make a node the selection: draw its edges, and write it into the
         * info panel. Clicking a node and picking it out of the search
         * results are the same act and now run the same code; the search
         * path used to set activeNode and call highlightNode by hand and
         * leave updateSummary out, so a searched node drew its edges but
         * did not appear as selected until it was clicked again.
         */
        function selectNode(d) {
            activeNode = d;
            highlightNode(d);
            updateSummary();
        }

        const searchBar = d3.select('#node-search');
        const dropdown = d3.select('#search-results');

        // Filter dropdown options as user types
        searchBar.on('input', function () {
            const query = this.value.toLowerCase();

            dropdown.selectAll('li').remove();

            if (query) {
                const matches = nodes.filter(n => n.label.toLowerCase().includes(query));

                if (matches.length > 0) {
                    dropdown.style('display', 'block');
                    dropdown.selectAll('li')
                        .data(matches)
                        .enter()
                        .append('li')
                        .style('padding', '5px')
                        .style('cursor', 'pointer')
                        .on('click', function (event, d) {
                            // Picking a result is a selection, the same as
                            // clicking the node: highlightNode draws the
                            // edges but the info panel is written by
                            // updateSummary, which was never called, so the
                            // node had to be clicked a second time before it
                            // showed up as selected.
                            selectNode(d);
                            searchBar.node().value = d.label;
                            dropdown.style('display', 'none');
                        })
                        .text(d => d.label);
                } else {
                    dropdown.style('display', 'none');
                }
            } else {
                dropdown.style('display', 'none');
            }
        });

        // Handle Enter key to select the first match
        searchBar.on('keydown', function (event) {
            if (event.key === 'Enter') {
                const query = this.value.toLowerCase();
                const match = nodes.find(n => n.label.toLowerCase().includes(query));

                if (match) {
                    selectNode(match);
                    dropdown.style('display', 'none');
                }
            }
        });

        // Create the ancestry toggle checkbox menu
        const ancestryToggle = d3.select('body')
            .append('div')
            .style('position', 'absolute')
            .style('top', '230px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white')
            .html(`
                <div>
                    <label>Select Ancestry:</label>
                </div>
                <div id="ancestry-checkboxes" style="border: 1px solid white; padding: 5px; max-width: 200px;">
                    <div><input type="checkbox" class="ancestry-option" value="meta" id="chk-meta"><label for="chk-meta">ALL</label></div>
                    <div><input type="checkbox" class="ancestry-option" value="amr" id="chk-amr"><label for="chk-amr">AMR</label></div>
                    <div><input type="checkbox" class="ancestry-option" value="eas" id="chk-eas"><label for="chk-eas">EAS</label></div>
                    <div><input type="checkbox" class="ancestry-option" value="afr" id="chk-afr"><label for="chk-afr">AFR</label></div>
                    <div><input type="checkbox" class="ancestry-option" value="eur" id="chk-eur"><label for="chk-eur">EUR</label></div>
                </div>
                <p style="font-size: 12px;">(Select one ancestry)</p>
            `);

        // Its own panel, so the layout below can put it last.
        d3.select('body')
            .append('div')
            .attr('id', 'reset-container')
            .style('position', 'absolute')
            .style('left', '10px')
            .style('padding', '10px')
            .html(`<button id="reset-view" style="background: #444; color: white; border: none; padding: 8px 12px; cursor: pointer; border-radius: 5px;">Reset view</button>`);


        // Enforce radio-button-like behavior with checkboxes
        d3.selectAll('.ancestry-option').on('change', function () {
            // Uncheck all checkboxes
            d3.selectAll('.ancestry-option').property('checked', false);
            // Check only the clicked one
            d3.select(this).property('checked', true);

            // Update ancestry variable
            ancestry = this.value;
            updateEdgeWeights(links, link);
        });

        // initialize the first checkbox as checked
        d3.select('#chk-meta').property('checked', true);

        // Create the p-value slider container
        const pValueSlider = d3.select('body')
            .append('div')
            .style('position', 'absolute')
            .style('top', '55px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white')
            .html(`
                <div>
                    <label for="pvalue-slider">Select P-Value:</label>
                </div>
                <input id="pvalue-slider" type="range" min="0" max="8" step="1">
                <span id="pvalue-label">${pvalue}</span>
            `);

        // Define the discrete p-value options
        const pvalueOptions = ['1e-12', '1e-11', '1e-10', '1e-09', '1e-08', '1e-07', '1e-06', '1e-05', '1e-04'];
        // const pvalueOptions = ['1e-04', '1e-05', '1e-06', '1e-07', '1e-08', '1e-09', '1e-10', '1e-11', '1e-12'];

        // Event listener for the slider
        d3.select('#pvalue-slider').on('input', function () {
            const index = +this.value; // Get the slider's value as an index
            pvalue = pvalueOptions[index]; // Update the globally accessible pvalue variable
            d3.select('#pvalue-label').text(pvalue); // Update the displayed value
            // console.log(`P-Value selected: ${pvalue}`);
            updateEdgeWeights(links, link);
            // Add additional logic to handle changes in p-value selection if needed
        });

        // Initialize the slider to the last option (1e-04)
        const initialIndex = pvalueOptions.indexOf(pvalue);
        d3.select('#pvalue-slider').property('value', initialIndex);

        const edgeToggle = d3.select('body')
            .append('div')
            .style('position', 'absolute')
            .style('top', '100px')
            .style('left', '10px')
            .style('background', 'transparent')
            .style('padding', '10px')
            .style('color', 'white')
            .html(`
                <div>
                    <label>Select Edge Type:</label>
                </div>
                <div id="edge-checkboxes" style="border: 1px solid white; padding: 5px; max-width: 200px;">
                    <div><input type="checkbox" class="edge-option" value="weight" id="chk-weight"><label for="chk-weight">Weight</label></div>
                    <div><input type="checkbox" class="edge-option" value="same_dir_weight" id="chk-same"><label for="chk-same">Concordant Weight</label></div>
                    <div><input type="checkbox" class="edge-option" value="diff_dir_weight" id="chk-diff"><label for="chk-diff">Discordant Weight</label></div>
                </div>
                <p style="font-size: 12px;">(Select one edge type)</p>
            `);

        // Enforce single-selection behavior like radio buttons
        d3.selectAll('.edge-option').on('change', function () {
            // Uncheck all checkboxes
            d3.selectAll('.edge-option').property('checked', false);
            // Check only the clicked one
            d3.select(this).property('checked', true);

            // Update edgeType variable
            edgeType = this.value;
            updateEdgeWeights(links, link);
        });

        // Initialize the first checkbox as checked
        d3.select('#chk-weight').property('checked', true);
        // Panels were positioned at hand-written offsets and the search bar
        // sat on top of the ancestry list. Lay them out from measured heights
        // instead: search second to last, reset last.
        // The toggle only appears once the server confirms the relation data
        // exists; on a deploy without it the page is unchanged.
        HierarchyMask.init().then(ok => {
            if (!ok) {
                if (HierarchyMask.enabled) {
                    console.warn('mask=1 was requested but the relation data ' +
                                 'is not built on this server');
                    HierarchyMask.enabled = false;
                }
                layoutPanels(null);
                return;
            }
            const maskContainer = HierarchyMask.control(() => {
                // Re-deriving the degrees is the whole cost of a toggle: no
                // request, no re-layout, just the same recompute an edge-type
                // change already does.
                degrees = computeDegrees();
                syncDegreeSlider();
                updateFilter();
                svg.selectAll('.label').each(function (d) {
                    buildLabel(d3.select(this), d, degrees[d.id] || 0);
                });
            });
            layoutPanels(maskContainer);
            if (HierarchyMask.enabled) {
                degrees = computeDegrees();
                syncDegreeSlider();
                updateFilter();
            }
        });

        function layoutPanels(maskContainer) {
            Panels.stackLeft([
                degreeFilterContainer.node(),
                pValueSlider.node(),
                edgeToggle.node(),
                ancestryToggle.node(),
                maskContainer,
                searchContainer.node(),
                document.getElementById('reset-container')
            ].filter(Boolean));
        }


        // Pull fresh weights for the current ancestry/p-value and write them
        // onto the existing link objects, then re-render.
        async function updateEdgeWeights(links, link) {
            if (!ancestry || !pvalue || !edgeType) {
                console.warn('One or more variables (ancestry, pvalue, edgeType) are undefined.');
                return;
            }

            let response;
            try {
                response = await fetch(
                    `/api/landing/edges?ancestry=${ancestry}&pvalue=${pvalue}` +
                    (HierarchyMask.needsEdgeRel() ? '&rel=1' : '')
                ).then(r => r.json());
            } catch (error) {
                console.error('Error fetching edge weights:', error);
                return;
            }

            const weights = new Map(
                response.edges.map(e => [`${e.source}|${e.target}`, e])
            );
            links.forEach(l => {
                const w = weights.get(`${l.source}|${l.target}`);
                l.same = w ? w.same : 0;
                l.diff = w ? w.diff : 0;
                if (w && w.rel !== undefined) l.rel = w.rel;
            });
            degrees = response.degrees;

            renderEdgeWeights(link);
        }

        function linkWeight(d) {
            if (edgeType === 'weight') return (d.same || 0) + (d.diff || 0);
            if (edgeType === 'same_dir_weight') return d.same || 0;
            return d.diff || 0;
        }

        // Rendered radius of a node, matching the `r` attribute set further
        // down. yHeight is assigned before anything can call this: the only
        // callers are drawLinks and renderEdgeWeights, and the one call that
        // happens during setup runs against an empty selection.
        function nodeRadius(id) {
            const n = nodeMap.get(id);
            return n ? n.size / yHeight / 1.1 : Infinity;
        }

        // Edge weight and node size come from unrelated columns, so an edge
        // could be drawn wider than the nodes it joins. Clamp to the diameter
        // of the smaller endpoint. Two map lookups per drawn edge, and only
        // the selected node's edges are ever drawn, so the cost is nil.
        function linkStrokeWidth(d) {
            const cap = 2 * Math.min(nodeRadius(d.source), nodeRadius(d.target));
            // Floor last, so a thin edge is visible even where the node cap
            // would be thinner still. Only edges that carry weight are ever
            // drawn, so this never conjures a line for an absent edge.
            return Math.max(MIN_STROKE_WIDTH, Math.min(linkWeight(d), cap));
        }

        /**
         * Live counts for what the current filters leave on screen. An edge
         * counts as present when either direction carries weight, matching the
         * degree calculation the server does. Concordant and discordant are
         * the same direction-of-effect split the edge-type filter uses, and an
         * edge can contribute to both, so the two do not sum to the total.
         */
        function updateSummary() {
            let syn = 0, anti = 0;
            for (const l of filteredLinks) {
                if ((l.same || 0) > 0) syn++;
                if ((l.diff || 0) > 0) anti++;
            }
            const shown = filteredLinks.length;
            Panels.summary([
                ['Phenotypes', filteredNodes.length],
                ['Associations', shown],
                ['\u00a0\u00a0concordant', syn],
                ['\u00a0\u00a0discordant', anti],
                activeNode ? ['Selected', activeNode.label] : null,
                activeNode ? ['\u00a0\u00a0degree', degrees[activeNode.id] || 0] : null
            ]);
        }

        // Swatch geometry: kept at the same ratio to the text as before, with
        // the vertical offset measured so its centre lines up.
        const SWATCH_FONT = 54;
        const SWATCH_DY = 0.2415;

        // Hover label, shared by the initial render and every filter redraw so
        // the two cannot drift apart.
        //
        // LABEL_FONT is halfway between the old 20px label and the old 13px
        // count panel, and panels.js uses the same size, so the two readouts
        // now match.
        const LABEL_FONT = 16.5;

        // Left edge of the label block. Normally the screen edge; on a short
        // window positionLabels moves it beside the control column.
        let labelX = 0.01 * window.innerWidth;

        function buildLabel(sel, d, degreeValue) {
            sel.selectAll('tspan').remove();

            const row = (text, dy) => sel.append('tspan')
                .attr('class', 'row')          // positionLabels moves these
                .text(text)
                .attr('x', labelX)
                .attr('dy', dy)
                .attr('font-size', `${LABEL_FONT}px`);

            row(`Phenotype: ${d.label}`, 0);
            row(`Category: ${d.category}`, '1.2em');

            // Colour swatch, sitting on the category line. The bullet glyph's
            // ink sits well above its own baseline, so at this size a positive
            // dy pushed it visibly below the text it belongs to; this raises it
            // back onto the text's centre line.
            sel.append('tspan')
                .html('&bull;')
                .style('fill', d.hex)
                .attr('dy', `${SWATCH_DY}em`)
                .style('font-size', `${SWATCH_FONT}px`);

            // Undo the swatch's baseline shift and advance one line. dy is in
            // units of each tspan's own font-size, so convert between the two.
            const back = (1.2 * LABEL_FONT - SWATCH_DY * SWATCH_FONT) / LABEL_FONT;
            row(`Degree under current filters: ${degreeValue}`, `${back}em`);
        }

        function renderEdgeWeights(link) {
            link.attr('stroke-width', linkStrokeWidth);

            // Ancestry, p-value and edge type all change which edges exist, so
            // the degrees, the slider range and the degree filter all have to
            // be recomputed here - not just the stroke widths.
            degrees = computeDegrees();
            syncDegreeSlider();
            updateFilter();

            // Update labels to reflect the current degree values
            svg.selectAll('.label')
                .each(function(d) {
                    buildLabel(d3.select(this), d, degrees[d.id] || 0);
                });
        
            // Redraw any visible labels
            svg.selectAll('.label')
                .each(function() {
                    if (d3.select(this).style('opacity') === '1') {
                        d3.select(this).style('opacity', 0);
                        d3.select(this).style('opacity', 1);
                    }
                });
        }
    
    // Edges are only ever visible for the node that is currently selected, so
    // only that node's lines are put in the DOM. Materialising all 54,790 up
    // front at opacity 0 left the browser laying out and compositing every one
    // of them on load and on every interaction.
    //
    // They go in their own group, created before the node circles below. SVG
    // paints in document order, so edges drawn on demand would otherwise land
    // on top of the nodes and swallow clicks meant for them.
    const linkLayer = content.append('g').attr('class', 'link-layer');
    let link = linkLayer.selectAll('.link');

    // links incident to each node, for drawLinks
    const linksByNode = new Map();
    links.forEach(l => {
        if (!linksByNode.has(l.source)) linksByNode.set(l.source, []);
        if (!linksByNode.has(l.target)) linksByNode.set(l.target, []);
        linksByNode.get(l.source).push(l);
        linksByNode.get(l.target).push(l);
    });

    function drawLinks(subset) {
        link = linkLayer.selectAll('.link')
            .data(subset, d => `${d.source}-${d.target}`)
            .join('line')
            .attr('class', 'link')
            .style('stroke', '#999')
            // nothing listens on edges here, and letting them take the pointer
            // blocks double-clicking a node to open its node view
            .style('pointer-events', 'none')
            .style('opacity', 1)
            .attr('stroke-width', linkStrokeWidth)
            .attr('x1', d => xScale(nodeMap.get(d.source).x))
            .attr('y1', d => yScale(nodeMap.get(d.source).y))
            .attr('x2', d => xScale(nodeMap.get(d.target).x))
            .attr('y2', d => yScale(nodeMap.get(d.target).y));
    }

        let activeNode = null;  // Store the currently active node reference
        let filteredNodes = nodes
        let filteredLinks = links
        // set mirrors of the two above, so membership tests in updateFilter and
        // highlightNode are O(1) instead of scanning the whole array each time
        let filteredNodeIds = new Set(nodes.map(n => n.id))
        let filteredLinkSet = new Set(links)

    const node = content.selectAll('.node')
        .data(nodes, d => d.id)
        .join('circle')
        .attr('class', 'node')
        .attr('r', d => d.size)
        .style('fill', d => d.color)
        // on mouseover give the node a bright outline
        .on('mouseover', function(event, d) {
            d3.select(this).style('stroke', 'white');
            d3.select(this).style('stroke-width', 2);
            // make the label opacity of the selected node 1
            labels.style('opacity', l => l.id === d.id ? 1 : 0);
            // console.log(d.id);
        })
        // on mouseout remove the outline
        .on('mouseout', function(event, d) {
            d3.select(this).style('stroke', 'none');
            // make the label opacity of the selected node 0
            labels.style('opacity', l => l.id === d.id ? 0 : 0);
        })
        .on('click', (event, d) => selectNode(d));
            

// `degrees` holds the per-node degree under the active filter and is
// refreshed by updateEdgeWeights whenever the filter changes.

function highlightNode(selectedNode) {
    if (!selectedNode) {
        // Reset styles when no node is selected
        node.style('opacity', 1);  // Reset node opacity
        drawLinks([]);             // Hide links
        labels.style('opacity', 0); // Hide labels

        // Restore original mouseover/mouseout behaviors
        node.on('mouseover', function(event, d) {
            d3.select(this).style('stroke', 'white').style('stroke-width', 2);
            labels.style('opacity', l => l.id === d.id ? 1 : 0);
        }).on('mouseout', function(event, d) {
            d3.select(this).style('stroke', 'none');
            labels.style('opacity', 0);
        });

        return;
    }

    const selectedNodeId = selectedNode.id;
    const neighbors = nodeNeighborsMap.get(selectedNodeId) || [];
    const neighborSet = new Set(neighbors);

    // Highlight only the selected node and its neighbors
    node.style('opacity', d =>
        (d.id === selectedNodeId || neighborSet.has(d.id)) && filteredNodeIds.has(d.id)
            ? 1 : 0.2
    );

    // Draw just this node's edges. Previously every link in the graph was
    // already in the DOM and this restyled all 54,790 of them, testing
    // membership by scanning an array - about 3e9 comparisons per click.
    drawLinks((linksByNode.get(selectedNodeId) || []).filter(l =>
        filteredLinkSet.has(l) &&
        nodeMap.has(l.source === selectedNodeId ? l.target : l.source)
    ));

    // on double click (only on the selected node) open dendrogram.html in a new tab and pass the ancestry and pvalue variables
    // as query parameters
    node.on('dblclick', function (event, d) {
        // console.log('Double-clicked node:', d);
        console.log(degrees[d.id]);

        if (!(degrees[d.id] > 0)) {
            // warn the user that the node has no edges
            console.log('This node has no edges.');
            alert('This node has no edges.');
            return;
        }
        else { 
            console.log('Opening page2.html in a new tab...');
            window.open(`page2.html?ancestry=${ancestry}&pvalue=${pvalue}&centerPheno=${d.id}`
                        + HierarchyMask.params());
            console.log('Double-clicked node:', d);
        }
    });

    // Add right-click context menu functionality
    node.on('contextmenu', function (event, d) {
        // clear any existing context menus
        d3.selectAll('.context-menu').remove();
        // Needs two distinct phenotypes. Right-clicking the node that is
        // already selected would open page 3 with leftPheno === rightPheno,
        // which has nothing to intersect, so offer nothing there.
        if (activeNode && d.id !== activeNode.id) {
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

            // Add "Open Sankey Diagram" option to the context menu
            contextMenu.append('div')
                .text('Open Edge View')
                .style('cursor', 'pointer')
                .style('padding', '5px')
                .on('click', function () {
                    // Open page3.html with selectedNode as leftPheno and the right-clicked node as rightPheno
                    // page 3 ignores the mask - it is one edge the user
                    // asked for by name - but the state travels with it so
                    // anything it opens keeps the setting.
                    window.open(`page3.html?ancestry=${ancestry}&pvalue=${pvalue}&leftPheno=${selectedNodeId}&rightPheno=${d.id}`
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

    // Restore mouseover events but only for highlighted nodes
    node.on('mouseover', function(event, d) {
        if (d.id === selectedNodeId || neighborSet.has(d.id)) {
            d3.select(this).style('stroke', 'white').style('stroke-width', 2);
            labels.style('opacity', l => l.id === d.id ? 1 : 0);
        }
    }).on('mouseout', function(event, d) {
        if (d.id === selectedNodeId || neighborSet.has(d.id)) {
            d3.select(this).style('stroke', 'none');
            labels.style('opacity', 0);
        }
    });
}

// Clear the selection. This was bound to Escape; it is now the "Reset view"
// button under the filters.
function resetView() {
    activeNode = null;
    highlightNode(null); // Reset all highlighting
    content.selectAll('rect').remove();
    updateSummary();
}
d3.select('#reset-view').on('click', resetView);


// console.log("Computed node degrees:", nodeDegrees); // Debugging output

// Add labels to the nodes
const labels = svg.selectAll('.label')
    .data(nodes)
    .enter()
    .append('text')
    .attr('class', 'label')
    .attr('dx', 0)
    .attr('dy', '.35em')
    .attr('font-size', `${LABEL_FONT}px`)
    .style('fill', 'white')  // Ensure text is visible against the black background
    .style('opacity', 0)
    .each(function(d) {
        buildLabel(d3.select(this), d, degrees[d.id] || 0);
    });

// First pass. Deferred to here because it applies the degree filter, which
// needs the node circles and the labels to exist.
renderEdgeWeights(link);




// Link endpoints are set once below, after the scales exist. Positioning them
// here as well cost a second pass over all 54,790 links for nothing.
node
    .attr('cx', d => d.x)
    .attr('cy', d => d.y);

labels
    .attr('x', d => 0)
    .attr('y', d => 0);

// recalculate positions so that no nodes are off the screen
// this is done by finding the min and max x and y values
// and then scaling all the x and y values so that they fit in the screen
const xValues = nodes.map(d => d.x);
const yValues = nodes.map(d => d.y);
const minX = Math.min(...xValues);
const maxX = Math.max(...xValues);
const minY = Math.min(...yValues);
const maxY = Math.max(...yValues);
const xScale = d3.scaleLinear().domain([minX, maxX]).range([0, width]);
const yScale = d3.scaleLinear().domain([minY, maxY]).range([0, height]);
node
    .attr('cx', d => xScale(d.x))
    .attr('cy', d => yScale(d.y));
labels
    .attr('x', d => 0.02 * width)
    .attr('y', d => 0.75 * height);

// Sit the hover label one line above the count panel, measured rather than
// guessed, so the two readouts read as one block instead of two floating
// captions. Runs after a frame so the panel has been laid out.
// Widest label in the set, measured once. Placement has to reason about the
// worst case, not whichever label happens to be first in the DOM - they all
// share a position, and the longest phenotype name is ~960px wide.
let maxLabelWidth = 0;
function measureLabels() {
    maxLabelWidth = 0;
    labels.each(function () {
        const w = this.getBBox().width;
        if (w > maxLabelWidth) maxLabelWidth = w;
    });
}

function positionLabels() {
    const readout = document.getElementById('bottom-left-stack');
    const controls = document.getElementById('left-stack');
    const sample = labels.node();
    if (!readout || !sample) return;
    const box = sample.getBBox();
    if (!box.height) return;
    if (!maxLabelWidth) measureLabels();

    // Two line breaks. One was enough until the readout grew: selecting a
    // phenotype with a long name wraps it onto a second line, pushing the
    // panel up into the label.
    const gap = 2 * 1.2 * LABEL_FONT;
    const margin = 16;
    const cRect = controls
        ? controls.getBoundingClientRect()
        : { bottom: 0, right: 0 };

    // Preferred spot: bottom left, just above the readout.
    let x = 0.01 * window.innerWidth;
    let top = readout.getBoundingClientRect().top - gap - box.height;

    // On a short window the control column reaches down into that space and
    // the label ended up behind the search bar. Put it beside the controls
    // instead, level with the first filter.
    if (top < cRect.bottom + margin) {
        x = cRect.right + margin;
        top = 14;

        // The longest phenotype name is ~960px wide, which on a narrow window
        // reaches the About buttons. Drop below them rather than run underneath.
        const about = document.getElementById('info-container');
        if (about) {
            const aRect = about.getBoundingClientRect();
            if (x + maxLabelWidth > aRect.left - margin) {
                const below = aRect.bottom + margin;
                const lowest = window.innerHeight - box.height - 10;
                if (below <= lowest) top = below;
            }
        }
    }

    labels.attr('y', +labels.attr('y') + (top - box.y));
    if (x !== labelX) {
        labelX = x;
        labels.selectAll('tspan.row').attr('x', x);
    }
}
requestAnimationFrame(() => {
    measureLabels();
    // Ask the filter column to leave room for the label block, so the label
    // keeps its place at the bottom left instead of being bumped aside; it
    // only moves when even a compressed column cannot spare the space.
    const h = labels.node() ? labels.node().getBBox().height : 0;
    Panels.extraReserve = h + 2 * 1.2 * LABEL_FONT + 16;
    if (Panels.__refit) Panels.__refit();
    positionLabels();
});
window.addEventListener('resize', () => requestAnimationFrame(positionLabels));
// Panels.summary calls this after the readout re-renders, so the label keeps
// its distance when the panel grows or shrinks.
Panels.onResize = positionLabels;

// Link endpoints are positioned in drawLinks, on the handful of lines that are
// actually on screen.
// now resize the nodes by dividing the size by the x range divided by the width
const xRange = maxX - minX;
const yRange = maxY - minY;
const xWidth = xRange / width;
const yHeight = yRange / height;
node
    .attr('r', d => d.size / yHeight / 1.1);

// Add zoom functionality
const zoom = d3.zoom()
    .scaleExtent([0.1, 10])
    .on('zoom', event => {
        content.attr('transform', event.transform);
    });

svg.call(zoom);
// Double-click opens the node view; d3.zoom also binds dblclick to zoom in,
// so the graph jumped as the new tab opened.
svg.on('dblclick.zoom', null);

// Center and zoom in (1.2x) around graph center
const dataCenterX = (minX + maxX) / 2;
const dataCenterY = (minY + maxY) / 2;
const scaledCenterX = xScale(dataCenterX);
const scaledCenterY = yScale(dataCenterY);
// console.log(xRange, yRange)
const zoomLevel = 1.8;
const tx = width / 2 - scaledCenterX * zoomLevel +xRange / 100;
const ty = height / 2 - scaledCenterY * zoomLevel +yRange / 100;

svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(zoomLevel));

// SHOW WELCOME BOX if not dismissed before
if (!localStorage.getItem('welcomeDismissed')) {
  const welcomeBox = d3.select('body')
    .append('div')
    .attr('id', 'welcome-box')
    .style('position', 'absolute')
    .style('top', '50%')
    .style('left', '50%')
    .style('transform', 'translate(-50%, -50%)')
    .style('padding', '20px')
    .style('background', 'rgba(0, 0, 0, 0.9)')
    .style('color', 'white')
    .style('border-radius', '8px')
    .style('z-index', '1000')
    .style('line-height', '1.6')
    .style('text-align', 'center')
    .html(`
      <p style="margin-bottom: 16px; font-size: 16px;">This network is a visualization of the data presented in 
        "Diversity and scale: Genetic architecture of 2068 traits in the VA Million Veteran Program" 
        (Anurag Verma et al, Science, DOI:10.1126). For more information about the
        network, click on the "About the network" button. </p> 
      <div style="margin-bottom: 12px;">
        <label><input type="checkbox" id="dont-show-again"> Don't show this again</label>
      </div>
      <button id="close-welcome" style="
        padding: 6px 12px;
        border: none;
        background-color: #555;
        color: white;
        border-radius: 4px;
        cursor: pointer;
      ">Close</button>
    `);

  d3.select('#close-welcome').on('click', () => {
    if (document.getElementById('dont-show-again').checked) {
      localStorage.setItem('welcomeDismissed', 'true');
    }
    d3.select('#welcome-box').remove();
  });
}
        
    }).catch(error => {
        console.error('Error loading CSV files:', error);
    });

    // Handle window resizing to adjust SVG dimensions
    window.addEventListener('resize', () => {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;

        svg
            .attr('width', newWidth)
            .attr('height', newHeight);
    });

// Create a container div for the button and info text
const infoContainer = d3.select('body')
    .append('div')
    .attr('id', 'info-container')
    .style('position', 'absolute')
    .style('top', '10px')
    .style('right', '10px')
    .style('background', 'transparent')
    .style('padding', '10px')
    .style('color', 'white');

// Add the button
const infoButton = infoContainer.append('button')
    .text('About the network')
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
        <h2>MVPheWAS Explorer: Phenotype Network</h2>
        <p>This network illuminates the shared genetic basis of phenotypes within
        the VA's Million Veteran Program (MVP). Each node is a phenotype, and each
        edge is made up of several genetic variants (SNPs). Every SNP in an edge is
        significantly associated with both the phenotypes it joins, which makes it
        easy to find groups of genetically connected phenotypes.</p>

        <p>Edge thickness is proportional to the number of SNPs in the edge, so an
        edge carrying 50 shared SNPs is drawn twice as thick as one carrying 25.
        Very thick edges are capped at the size of the smaller phenotype they
        connect, so they cannot swallow the nodes. Nodes are colored by phenotype
        category, taken from the phenotype's Phecode mapping; running a
        force-directed layout clusters those categories together, which suggests the
        mapping is a reasonable way to group phenotypes in the network.</p>

        <h3>Filters</h3>
        <p>The gwPheWAS was run separately on each ancestry subgroup within MVP, so
        the ancestry filter shows each of those subnetworks on its own. The p-value
        slider sets how strong a SNP-phenotype association has to be to count, and
        the degree filter hides phenotypes with few connections.</p>

        <p>Sometimes only SNPs that affect both of their phenotypes in the same
        direction are of interest (a concordant association), and sometimes only
        those with opposite effects (a discordant association). The edge type filter
        switches between them.</p>

        <h3>Exploring</h3>
        <p>Clicking a node reveals its local network by showing its edges, which is a
        good way to explore around a particular phenotype. The panel at the bottom
        left counts what is currently on screen. "Reset view" clears the selection.</p>

        <p>Double-clicking a node opens the Phenotype view, a more detailed look at
        how that phenotype relates to its neighbors. While a node is selected,
        right-clicking one of its neighbors opens the SNP view for the edge between
        them, showing the individual SNPs that make it up.</p>

        <h3>About the data</h3>
        <p>This website is a visualization tool and download portal for the data
        presented in "Diversity and scale: Genetic architecture of 2068 traits in the
        VA Million Veteran Program" (Anurag Verma et al., <em>Science</em> 385,
        eadj1182 (2024), DOI: 10.1126/science.adj1182). For questions about this
        website contact the MVP Data Core at
        <a href="mailto:mvpdatacore@va.gov">mvpdatacore@va.gov</a>.</p>
    `);

// add a download button to download data as a csv file
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
        // redirect people to dbgap
        window.open('https://ftp.ncbi.nlm.nih.gov/dbgap/studies/phs002453/analyses/', '_blank');

    });

    
});

