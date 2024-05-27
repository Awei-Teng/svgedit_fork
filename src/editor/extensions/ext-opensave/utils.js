/* metadata  */
// 还原metadata标签数据
function replaceSvgMetadata(svgString, metadataArray) {
        // 将 SVG 字符串转换为 DOM 对象
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');

        // 遍历 metadataArray,并替换 SVG 中的 metadata 元素
        metadataArray.forEach(({ id, content }) => {
                const metadataElement = svgDoc.querySelector(`metadata[id="${id}"]`);
                if (metadataElement) {
                        metadataElement.innerHTML = content;
                }
        });

        // 将修改后的 SVG DOM 对象转换回字符串
        const enhancedSvgString = new XMLSerializer().serializeToString(svgDoc);
        return enhancedSvgString;
}
// 存储metadata数据
function extractAndEnhanceMetadata(svgString) {
        // 1. 解析 SVG 字符串为 DOM 对象
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');

        // 2. 获取所有 metadata 元素
        const metadataElements = svgDoc.querySelectorAll('metadata');

        // 3. 遍历 metadata 元素,提取内容并添加 ID
        const metadataArray = [];

        metadataElements.forEach((metadataElement, index) => {
                // 为每个 metadata 元素添加一个 ID
                metadataElement.setAttribute('id', `my-metadata-${index}`);

                // 获取 metadata 元素的内容
                const metadataContent = metadataElement.innerHTML.trim();

                // 将 metadata 内容和 ID 存放在数组中
                metadataArray.push({
                        id: `my-metadata-${index}`,
                        content: metadataContent
                });
        });

        // 4. 使用修改后的 metadata 元素重新构建 SVG 字符串
        const enhancedSvgString = new XMLSerializer().serializeToString(svgDoc);

        return { enhancedSvgString, metadataArray };
}
// 辅助函数：将SVG字符串解析为DOM
function parseSVG(svgString) {
        const parser = new DOMParser();
        return parser.parseFromString(svgString, "image/svg+xml");
}

// 辅助函数：将DOM序列化为SVG字符串
function serializeSVG(svgDoc) {
        const serializer = new XMLSerializer();
        return serializer.serializeToString(svgDoc);
}
// 给SVG所有dom添加ID
function addDomId(svgDom) {
        // 1. 遍历 svgDom 中的所有元素,如果没有 id,就添加一个 id
        const elements1 = svgDom.getElementsByTagName('*');
        for (let i = 0; i < elements1.length; i++) {
                const element1 = elements1[i];
                if (!element1.hasAttribute('id')) {
                        element1.setAttribute('id', 'qz' + Math.random().toString(36).substring(2, 7));
                }
        }
        console.log(svgDom, 'svgDomsvgDom');
}
// 辅助函数：比较两个DOM的差异，并返回补全后的DOM
function compareAndFillSvgDom(svgDom1, svgDom2) {
        const elements1 = svgDom1.getElementsByTagName('*');
        // 2. 遍历 svgDom1 中的所有元素
        for (let i = 0; i < elements1.length; i++) {
                const element1 = elements1[i];

                // 3. 在 svgDom1 中找到对应的元素
                const element2 = svgDom2.getElementById(element1.getAttribute('id'));
                if (!element2) { continue }
                // 4. 比较 element1 的属性,如果在 element2 中找不到,就添加到 element1
                const attributes1 = element1.attributes;
                for (let j = 0; j < attributes1.length; j++) {
                        const attr1 = attributes1[j];
                        if (!element2.hasAttribute(attr1.name)) {
                                element2.setAttribute(attr1.name, attr1.value);
                        }
                }
        }

        return svgDom2;
}

// 默认新建图层，打开的文件不可编辑
function customInitLayer(params) {
        console.log(initSvgDom.querySelectorAll('.layer').length,'initSvgDom.querySelectorAll')
        if(initSvgDom.querySelectorAll('.layer').length === 0){
                svgEditor.svgCanvas.createLayer('图层 1')
                svgEditor.layersPanel.updateContextPanel()
                svgEditor.layersPanel.populateLayers()
        }
}
export {
        replaceSvgMetadata,
        extractAndEnhanceMetadata,
        parseSVG,
        serializeSVG,
        addDomId,
        compareAndFillSvgDom,
        customInitLayer
}
