# VA MVP Data visualization website
This repository is deployed through railway at [appliedintegrativeanalytics.com](appliedintegrativeanalytics.com)

## Running locally
```bash
npm install
npm start          # http://localhost:3000
```

## Data layer
The pages no longer download CSVs and filter them in the browser; they query
DuckDB/Parquet files through endpoints in `server.js`. Those files are not in
the repo: in production they live on a Railway volume at `/data/db`, and
locally in `public/data/db/` (gitignored). See
[docs/duckdb-migration.md](docs/duckdb-migration.md) for the schema, the
endpoint list, how to rebuild the files, and the validation scripts.

## Code structure and logic
The website has 3 pages, each has a .js file in ```public/js```. The following is meant as a high level overview of the code logic, not an in depth guide. 
### Page 1
Page 1 is the landing page of the website, and shows a network of <1,000 phenotypes, where pairs of phenotypes linked by bundles of SNPs that are associated with both. Computing this network from the raw associations is resource intensive and takes several minutes, so networks have been precalculated for a variety of different filtering criteria, and the edge weights have been saved in ```public/data/edgelist_updated_scaled.csv```. 
The basic logic of the code is to use the edgelist and the node attributes (```public/data/node_attributes.csv```) to build a 'maximally connected' network (not fully connected, but containing every edge that appears under any filtering criteria). Then we apply a column from the edgelist as edge weights. Many of these weights will be 0, turning those edges into 'ghost edges'. 

This means that almost all of the functionality of page 1 is contained in the filtering functions, and the update edge weights function. The workflow is as follows.
1. A filter is changed. It returns a string corresponding to its new value, for example ```1e-04``` for the p value slider. 
2. The other filters also send their current values to the update edge weights function
3. The update edge weights function requests ```/api/landing/edges``` with the current ancestry and p value. The server concatenates the strings into a column name (for example, ```amr_1e-04_same_dir_weight```) and returns just that pair of weight columns, plus the node degrees under that filter.
4. It writes the returned weights onto the existing links and applies them, finishing the network update.
### Pages 2 and 3
These two pages have the exact same structure, because they visualize very similar information. The networks here are much simpler to construct, so the workflow is as follows
1. Request the association rows for the relevant node (given by the user selection) from ```/api/page2/rows``` or ```/api/page3/rows```. The server returns only the rows the page can actually draw — for page 2 the centre phenotype's 150 strongest SNPs and everything associated with them, for page 3 the SNPs the two phenotypes share.
2. Build the network based on the default settings of the filters
3. Render the network based on a set of layout rules (spacing between nodes, positioning of different types of nodes, etc)
4. Repeat 2 and 3 every time a filter is changed. On page 2 the p value sliders re-filter the rows already loaded; only an ancestry change needs a new request.

The networks in pages 2 and 3 are bipartite, meaning that the two types of nodes (SNPs and phenotypes) do not have edges to nodes of the same type. This means that our csv of phenotype-SNP associations is just an edgelist, and the network can be constructed very quickly and easily by filtering this csv. 

Much of the complexity in this relatively simple workflow comes from the option to compare 2 ancestries. When a second ancestry is selected, the visualization switches to an intersection network, where edges are only displayed if they appear in both ancestries. A different color scheme is applied to show the different meanings of the edges, and the filters have to be run on two different sets of edges to create the network before it can be rendered. 
