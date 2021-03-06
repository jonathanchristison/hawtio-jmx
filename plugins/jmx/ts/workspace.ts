/// <reference path="jmxHelpers.ts"/>

namespace Jmx {

  var log:Logging.Logger = Logger.get("workspace");

  /**
   * @class NavMenuItem
   */
  export interface NavMenuItem {
    id: string;
    content: string;
    title?: string;
    isValid?: (workspace:Workspace, perspectiveId?:string) => any;
    isActive?: (worksace:Workspace) => boolean;
    href: () => any;
  }

  /**
   * @class Workspace
   */
  export class Workspace {
    public operationCounter = 0;
    public selection: NodeSelection;
    public tree:Folder = new Folder('MBeans');
    public mbeanTypesToDomain = {};
    public mbeanServicesToDomain = {};
    public attributeColumnDefs = {};
    public onClickRowHandlers = {};
    public treePostProcessors = {};
    public topLevelTabs:any = undefined 
    public subLevelTabs = [];
    public keyToNodeMap = {};
    public pluginRegisterHandle = null;
    public pluginUpdateCounter = null;
    public treeWatchRegisterHandle = null;
    public treeWatcherCounter = null;
    public treeFetched = false;
    // mapData allows to store arbitrary data on the workspace
    public mapData = {};

    private rootId = 'root';
    private separator = '-';

    constructor(public jolokia: Jolokia.IJolokia,
      public jolokiaStatus,
      public jmxTreeLazyLoadRegistry,
      public $location: ng.ILocationService,
      public $compile: ng.ICompileService,
      public $templateCache: ng.ITemplateCacheService,
      public localStorage: WindowLocalStorage,
      public $rootScope: ng.IRootScopeService,
      public HawtioNav: HawtioMainNav.Registry) {

      // set defaults
      if (!('autoRefresh' in localStorage)) {
        localStorage['autoRefresh'] = true;
      }
      if (!('updateRate' in localStorage)) {
        localStorage['updateRate'] = 5000;
      }
      var workspace = this;
      this.topLevelTabs = {
        push: (item:NavMenuItem) => {
          log.debug("Added menu item: ", item);
          var tab = {
            id: item.id,
            title: () => item.content,
            isValid: () => item.isValid(workspace),
            href: () => UrlHelpers.noHash(item.href()),
          }
          if (item.isActive) {
            tab['isSelected'] = () => item.isActive(workspace);
          }
          workspace.HawtioNav.add(tab);
        },
        find: (search:(NavMenuItem) => void) => {

        }
      };
    }

    /**
     * Creates a shallow copy child workspace with its own selection and location
     * @method createChildWorkspace
     * @param {ng.ILocationService} location
     * @return {Workspace}
     */
    public createChildWorkspace(location): Workspace {
      const child = new Workspace(this.jolokia, this.jolokiaStatus, this.jmxTreeLazyLoadRegistry,
        this.$location, this.$compile, this.$templateCache, this.localStorage, this.$rootScope, this.HawtioNav);
      // lets copy across all the properties just in case
      angular.forEach(this, (value, key) => child[key] = value);
      child.$location = location;
      return child;
    }

    getLocalStorage(key:string) {
      return this.localStorage[key];
    }

    setLocalStorage(key:string, value:any) {
      this.localStorage[key] = value;
    }

    public loadTree() {
      var workspace = this;
      if (this.jolokia['isDummy']) {
        setTimeout(() => {
          workspace.treeFetched = true;
          workspace.populateTree({
            value: {}
          });
        }, 10);
        return;
      }

      var flags = {
        ignoreErrors: true,
        error: (response) => {
          workspace.treeFetched = true;
          log.debug("Error fetching JMX tree: ", response);
        }
      };
      log.debug("jolokia: ", this.jolokia);
      this.jolokia.request({ 'type': 'list' }, Core.onSuccess((response) => {
        if (response.value) {
          this.jolokiaStatus.xhr = null;
        }
        workspace.treeFetched = true;
        workspace.populateTree(response);
      }, flags));
    }

    /**
     * Adds a post processor of the tree to swizzle the tree metadata after loading
     * such as correcting any typeName values or CSS styles by hand
     * @method addTreePostProcessor
     * @param {Function} processor
     */
    public addTreePostProcessor(processor:(tree:any) => void) {
      var numKeys = _.keys(this.treePostProcessors).length;
      var nextKey = numKeys + 1;
      return this.addNamedTreePostProcessor(nextKey + '', processor);
    }

    public addNamedTreePostProcessor(name:string, processor:(tree:any) => void) {
      this.treePostProcessors[name] = processor;
      var tree = this.tree;
      if (this.treeFetched && tree) {
        // the tree is loaded already so lets process it now :)
        processor(tree);
      }
      return name;
    }

    public removeNamedTreePostProcessor(name:string) {
      delete this.treePostProcessors[name];
    }

    public maybeMonitorPlugins() {
      if (this.treeContainsDomainAndProperties("hawtio", {type: "Registry"})) {
        if (this.pluginRegisterHandle === null) {
          let callback = <(...response:Jolokia.IResponse[]) => void> angular.bind(this, this.maybeUpdatePlugins);
          this.pluginRegisterHandle = this.jolokia.register(callback, {
            type: "read",
            mbean: "hawtio:type=Registry",
            attribute: "UpdateCounter"
          });
        }
      } else {
        if (this.pluginRegisterHandle !== null) {
          this.jolokia.unregister(this.pluginRegisterHandle);
          this.pluginRegisterHandle = null;
          this.pluginUpdateCounter = null;
        }
      }

      // lets also listen to see if we have a JMX tree watcher
      if (this.treeContainsDomainAndProperties("hawtio", {type: "TreeWatcher"})) {
        if (this.treeWatchRegisterHandle === null) {
          let callback = <(...response:Jolokia.IResponse[]) => void> angular.bind(this, this.maybeReloadTree);
          this.treeWatchRegisterHandle = this.jolokia.register(callback, {
            type: "read",
            mbean: "hawtio:type=TreeWatcher",
            attribute: "Counter"
          });
        }
      }
    }

    public maybeUpdatePlugins(response) {
      if (this.pluginUpdateCounter === null) {
        this.pluginUpdateCounter = response.value;
        return;
      }
      if (this.pluginUpdateCounter !== response.value) {
        if (Core.parseBooleanValue(localStorage['autoRefresh'])) {
          window.location.reload();
        }
      }
    }

    public maybeReloadTree(response) {
      var counter = response.value;
      if (this.treeWatcherCounter === null) {
        this.treeWatcherCounter = counter;
        return;
      }
      if (this.treeWatcherCounter !== counter) {
        this.treeWatcherCounter = counter;
        this.jolokia.list(null, Core.onSuccess(response => this.populateTree({ value: response }),
          {ignoreErrors: true, maxDepth: 2}));
      }
    }

    public populateTree(response): void {
      log.debug("JMX tree has been loaded, data: ", response.value);

      this.mbeanTypesToDomain = {};
      this.mbeanServicesToDomain = {};
      this.keyToNodeMap = {};

      var newTree = new Folder('MBeans');
      newTree.key = this.rootId;
      var domains = <Core.JMXDomains>response.value;
      angular.forEach(domains, (domain, domainName) => {
        // domain name is displayed in the tree, so let's escape it here
        // Core.escapeHtml() and _.escape() cannot be used, as escaping '"' breaks Camel tree...
        this.populateDomainFolder(newTree, this.escapeTagOnly(domainName), domain);
      });

      newTree.sortChildren(true);

      // now lets mark the nodes with no children as lazy loading...
      this.enableLazyLoading(newTree);
      this.tree = newTree;

      var processors = this.treePostProcessors;
      _.forIn(processors, (fn: (Folder) => void, key) => {
        log.debug("Running tree post processor: ", key);
        fn(newTree);
      });

      this.maybeMonitorPlugins();

      var rootScope = this.$rootScope;
      if (rootScope) {
        rootScope.$broadcast('jmxTreeUpdated');
        Core.$apply(rootScope);
      }
    }

    private initFolder(folder: Folder, domain: string, folderNames: string[]): void {
      folder.domain = domain;
      if (!folder.key) {
        folder.key = this.rootId + this.separator + folderNames.join(this.separator);
      }
      folder.folderNames = folderNames;
      log.debug("    folder: domain=" + folder.domain + ", key=" + folder.key);
    }

    private populateDomainFolder(tree: Folder, domainName: string, domain: Core.JMXDomain): void {
      log.debug("JMX tree domain: " + domainName);
      var domainClass = Core.escapeDots(domainName);
      var folder = this.folderGetOrElse(tree, domainName);
      this.initFolder(folder, domainName, [domainName]);
      angular.forEach(domain, (mbean, mbeanName) => {
        this.populateMBeanFolder(folder, domainClass, mbeanName, mbean);
      });
    }

    /**
     * Escape only '<' and '>' as opposed to Core.escapeHtml() and _.escape()
     * 
     * @param {string} str string to be escaped
    */
    private escapeTagOnly(str: string): string {
      var tagChars = {
        "<": "&lt;",
        ">": "&gt;"
      };
      if (!angular.isString(str)) {
        return str;
      }
      var escaped = "";
      for (var i = 0; i < str.length; i++) {
        var c = str.charAt(i);
        escaped += tagChars[c] || c;
      }
      return escaped;
    }

    private populateMBeanFolder(domainFolder: Folder, domainClass: string, mbeanName: string, mbean: Core.JMXMBean): void {
      log.debug("  JMX tree mbean: " + mbeanName);

      var entries = {};
      var paths = [];
      var typeName = null;
      var serviceName = null;
      mbeanName.split(',').forEach(prop => {
        // do not use split('=') as it splits wrong when there is a space in the mbean name
        // var kv = prop.split('=');
        var kv = this.splitMBeanProperty(prop);
        var propKey = kv[0];
        // mbean property value is displayed in the tree, so let's escape it here
        // Core.escapeHtml() and _.escape() cannot be used, as escaping '"' breaks Camel tree...
        var propValue = this.escapeTagOnly(kv[1] || propKey);
        entries[propKey] = propValue;
        var moveToFront = false;
        var lowerKey = propKey.toLowerCase();
        if (lowerKey === "type") {
          typeName = propValue;
          // if the type name value already exists in the root node
          // of the domain then lets move this property around too
          if (domainFolder.get(propValue)) {
            moveToFront = true;
          }
        }
        if (lowerKey === "service") {
          serviceName = propValue;
        }
        if (moveToFront) {
          paths.unshift(propValue);
        } else {
          paths.push(propValue);
        }
      });

      var folder = domainFolder;
      var domainName = domainFolder.domain;
      var folderNames = _.clone(domainFolder.folderNames);
      var lastPath = paths.pop();
      paths.forEach(path => {
        folder = this.folderGetOrElse(folder, path);
        if (folder) {
          folderNames.push(path);
          this.configureFolder(folder, domainName, domainClass, folderNames, path);
        }
      });

      if (folder) {
        folder = this.folderGetOrElse(folder, lastPath);
        if (folder) {
          // lets add the various data into the folder
          folder.entries = entries;
          folderNames.push(lastPath);
          this.configureFolder(folder, domainName, domainClass, folderNames, lastPath);
          folder.text = Core.trimQuotes(lastPath);
          folder.objectName = domainName + ":" + mbeanName;
          folder.mbean = mbean;
          folder.typeName = typeName;

          if (serviceName) {
            this.addFolderByDomain(folder, domainName, serviceName, this.mbeanServicesToDomain);
          }
          if (typeName) {
            this.addFolderByDomain(folder, domainName, typeName, this.mbeanTypesToDomain);
          }
        }
      } else {
        log.info("No folder found for last path: " + lastPath);
      }
    }

    private folderGetOrElse(folder: Folder, name: string): Folder {
      if(folder) {
        return folder.getOrElse(name);
      }
    return null;
    }

    private splitMBeanProperty(property: string): [string, string] {
      var pos = property.indexOf('=');
      if (pos > 0) {
        return [property.substr(0, pos), property.substr(pos + 1)];
      } else {
        return [property, property];
      }
    }

    public configureFolder(folder: Folder, domainName: string, domainClass: string, folderNames: string[], path: string): Folder {
      this.initFolder(folder, domainName, _.clone(folderNames));
      this.keyToNodeMap[folder.key] = folder;
      var classes = "";
      var typeKey = _.filter(_.keys(folder.entries), key => key.toLowerCase().indexOf("type") >= 0);
      if (typeKey.length) {
        // last path
        angular.forEach(typeKey, key => {
          var typeName = folder.entries[key];
          if (!folder.ancestorHasEntry(key, typeName)) {
            classes += " " + domainClass + this.separator + typeName;
          }
        });
      } else {
        // folder
        var kindName = _.last(folderNames);
        if (kindName === path) {
          kindName += "-folder";
        }
        if (kindName) {
          classes += " " + domainClass + this.separator + kindName;
        }
      }
      folder.class = Core.escapeTreeCssStyles(classes);
      return folder;
    }

    private addFolderByDomain(folder: Folder, domainName: string, typeName: string, owner: any): void {
      var map = owner[typeName];
      if (!map) {
        map = {};
        owner[typeName] = map;
      }
      var value = map[domainName];
      if (!value) {
        map[domainName] = folder;
      } else {
        var array = null;
        if (angular.isArray(value)) {
          array = value;
        } else {
          array = [value];
          map[domainName] = array;
        }
        array.push(folder);
      }
    }

    private enableLazyLoading(folder: Folder) {
      const children = folder.children;
      if (children && children.length) {
        angular.forEach(children, (child: Folder) => this.enableLazyLoading(child));
      } else {
        // we have no children so enable lazy loading if we have a custom loader registered
        const lazyFunction = Jmx.findLazyLoadingFunction(this, folder);
        if (lazyFunction) {
          folder.lazyLoad = true;
        } else {
          folder.icon = 'fa fa-cube';
        }
      }
    }

    /**
     * Returns the hash query argument to append to URL links
     * @method hash
     * @return {String}
     */
    public hash() {
      var hash = this.$location.search();
      var params = Core.hashToString(hash);
      if (params) {
        return "?" + params;
      }
      return "";
    }

    /**
     * Returns the currently active tab
     * @method getActiveTab
     * @return {Boolean}
     */
    public getActiveTab() {
      var workspace = this;
      return _.find(this.topLevelTabs, tab => {
        if (!angular.isDefined(tab.isActive)) {
          return workspace.isLinkActive(tab.href());
        } else {
          return tab.isActive(workspace);
        }
      });
    }

    private getStrippedPathName() {
      var pathName = Core.trimLeading((this.$location.path() || '/'), "#");
      pathName = pathName.replace(/^\//, '');
      return pathName;
    }

    public linkContains(...words:String[]):boolean {
      var pathName = this.getStrippedPathName();
      return _.every(words, (word:string) => pathName.indexOf(word) !== 0);
    }

    /**
     * Returns true if the given link is active. The link can omit the leading # or / if necessary.
     * The query parameters of the URL are ignored in the comparison.
     * @method isLinkActive
     * @param {String} href
     * @return {Boolean} true if the given link is active
     */
    public isLinkActive(href:string):boolean {
      // lets trim the leading slash
      var pathName = this.getStrippedPathName();

      var link = Core.trimLeading(href, "#");
      link = link.replace(/^\//, '');
      // strip any query arguments
      var idx = link.indexOf('?');
      if (idx >= 0) {
        link = link.substring(0, idx);
      }
      if (!pathName.length) {
        return link === pathName;
      } else {
        return _.startsWith(pathName, link);
      }
    }

    /**
     * Returns true if the given link is active. The link can omit the leading # or / if necessary.
     * The query parameters of the URL are ignored in the comparison.
     * @method isLinkActive
     * @param {String} href
     * @return {Boolean} true if the given link is active
     */
    public isLinkPrefixActive(href:string):boolean {
      // lets trim the leading slash
      var pathName = this.getStrippedPathName();

      var link = Core.trimLeading(href, "#");
      link = link.replace(/^\//, '');
      // strip any query arguments
      var idx = link.indexOf('?');
      if (idx >= 0) {
        link = link.substring(0, idx);
      }
      return _.startsWith(pathName, link);
    }

    /**
     * Returns true if the tab query parameter is active or the URL starts with the given path
     * @method isTopTabActive
     * @param {String} path
     * @return {Boolean}
     */
    public isTopTabActive(path:string):boolean {
      var tab = this.$location.search()['tab'];
      if (angular.isString(tab)) {
        return _.startsWith(tab, path);
      }
      return this.isLinkActive(path);
    }

    public isMainTabActive(path:string):boolean {
      var tab = this.$location.search()['main-tab'];
      if (angular.isString(tab)) {
        return tab === path;
      }
      return false;
    }

    /**
     * Returns the selected mbean name if there is one
     * @method getSelectedMBeanName
     * @return {String}
     */
    public getSelectedMBeanName():string {
      var selection = this.selection;
      if (selection) {
        return selection.objectName;
      }
      return null;
    }

    public getSelectedMBean(): NodeSelection {
      if (this.selection) {
        return this.selection;
      }
      log.debug("Location: ", this.$location);
      var nid = this.$location.search()['nid'];
      if (nid && this.tree) {
        var answer = this.tree.findDescendant(node => nid === node.key);
        if (!this.selection) {
          this.selection = answer;
        }
        return answer;
      }
      return null;
    }

    /**
     * Returns true if the path is valid for the current selection
     * @method validSelection
     * @param {String} uri
     * @return {Boolean}
     */
    public validSelection(uri:string) {
      // TODO
      return true;
    }

    /**
     * In cases where we have just deleted something we typically want to change
     * the selection to the parent node
     * @method removeAndSelectParentNode
     */
    public removeAndSelectParentNode() {
      var selection = this.selection;
      if (selection) {
        var parent = selection.parent;
        if (parent) {
          // lets remove the selection from the parent so we don't do any more JMX attribute queries on the children
          // or include it in table views etc
          // would be nice to eagerly remove the tree node too?
          var idx = parent.children.indexOf(selection);
          if (idx < 0) {
            idx = _.findIndex(parent.children, n => n.key === selection.key);
          }
          if (idx >= 0) {
            parent.children.splice(idx, 1);
          }
          this.updateSelectionNode(parent);
        }
      }
    }

    public selectParentNode() {
      var selection = this.selection;
      if (selection) {
        var parent = selection.parent;
        if (parent) {
          this.updateSelectionNode(parent);
        }
      }
    }

    /**
     * Returns the view configuration key for the kind of selection
     * for example based on the domain and the node type
     * @method selectionViewConfigKey
     * @return {String}
     */
    public selectionViewConfigKey():string {
      return this.selectionConfigKey("view/");
    }

    /**
     * Returns a configuration key for a node which is usually of the form
     * domain/typeName or for folders with no type, domain/name/folder
     * @method selectionConfigKey
     * @param {String} prefix
     * @return {String}
     */
    public selectionConfigKey(prefix: string = ""):string {
      var key:string = null;
      var selection = this.selection;
      if (selection) {
        // lets make a unique string for the kind of select
        key = prefix + selection.domain;
        var typeName = selection.typeName;
        if (!typeName) {
          typeName = selection.text;
        }
        key += "/" + typeName;
        if (selection.isFolder()) {
          key += "/folder";
        }
      }
      return key;
    }

    public moveIfViewInvalid() {
      var workspace = this;
      var uri = Core.trimLeading(this.$location.path(), "/");
      if (this.selection) {
        var key = this.selectionViewConfigKey();
        if (this.validSelection(uri)) {
          // lets remember the previous selection
          this.setLocalStorage(key, uri);
          return false;
        } else {
          log.info("the uri '" + uri + "' is not valid for this selection");
          // lets look up the previous preferred value for this type
          var defaultPath = this.getLocalStorage(key);
          if (!defaultPath || !this.validSelection(defaultPath)) {
            // lets find the first path we can find which is valid
            defaultPath = null;
            angular.forEach(this.subLevelTabs, (tab) => {
              var fn = tab.isValid;
              if (!defaultPath && tab.href && angular.isDefined(fn) && fn(workspace)) {
                defaultPath = tab.href();
              }
            });
          }
          if (!defaultPath) {
            defaultPath = "#/jmx/help";
          }
          log.info("moving the URL to be " + defaultPath);
          if (_.startsWith(defaultPath, "#")) {
            defaultPath = defaultPath.substring(1);
          }
          this.$location.path(defaultPath);
          return true;
        }
      } else {
        return false;
      }
    }

    public updateSelectionNode(node: NodeSelection) {
      this.selection = node;
      var key:string = null;
      if (node) {
        key = node.key;
      }
      if (key) {
        var $location = this.$location;
        var q = $location.search();
        q['nid'] = key;
        $location.search(q);
      }
      // Broadcast an event so other parts of the UI can update accordingly
      this.$rootScope.$broadcast('jmxTreeClicked', this.selection);

      // if we have updated the selection (rather than just loaded a page)
      // lets use the previous preferred view - otherwise we may be loading
      // a page from a bookmark so lets not change the view :)
      /*
      if (originalSelection) {
        key = this.selectionViewConfigKey();
        if (key) {
          var defaultPath = this.getLocalStorage(key);
          if (defaultPath) {
            this.$location.path(defaultPath);
          }
        }
      }*/
    }

    private matchesProperties(entries, properties) {
      if (!entries) return false;
      for (var key in properties) {
        var value = properties[key];
        if (!value || entries[key] !== value) {
          return false;
        }
      }
      return true;
    }

    public hasInvokeRightsForName(objectName:string, ...methods:Array<string>) {
      // allow invoke by default, same as in hasInvokeRight() below???
      var canInvoke = true;
      if (objectName) {
        var mbean = Core.parseMBean(objectName);
        if (mbean) {
          var mbeanFolder = this.findMBeanWithProperties(mbean.domain, mbean.attributes);
          if (mbeanFolder) {
            return this.hasInvokeRights.apply(this, [mbeanFolder].concat(methods));
          } else {
            log.debug("Failed to find mbean folder with name " + objectName);
          }
        } else {
          log.debug("Failed to parse mbean name " + objectName);
        }
      }
      return canInvoke;
    }

    public hasInvokeRights(selection: NodeSelection, ...methods:Array<string>) {
      var canInvoke = true;
      if (selection) {
        var selectionFolder = <Folder> selection;
        var mbean = selectionFolder.mbean;
        if (mbean) {
          if (angular.isDefined(mbean.canInvoke)) {
            canInvoke = mbean.canInvoke;
          }
          if (canInvoke && methods && methods.length > 0) {
            var opsByString = mbean['opByString'];
            var ops = mbean['op'];
            if (opsByString && ops) {
              methods.forEach((method) => {
                if (!canInvoke) {
                  return;
                }
                var op = null;
                if (_.endsWith(method, ')')) {
                  op = opsByString[method];
                } else {
                  op = ops[method];
                }
                if (!op) {
                  log.debug("Could not find method:", method, " to check permissions, skipping");
                  return;
                }
                if (angular.isDefined(op.canInvoke)) {
                  canInvoke = op.canInvoke;
                }
              });
            }
          }
        }
      } 
      return canInvoke;
    }

    public treeContainsDomainAndProperties(domainName, properties = null) {
      var workspace = this;
      var tree = workspace.tree;
      if (tree) {
        var folder = tree.get(domainName);
        if (folder) {
          if (properties) {
            var children = folder.children || [];
            var checkProperties = (node)  => {
              if (!this.matchesProperties(node.entries, properties)) {
                if (node.domain === domainName && node.children && node.children.length > 0) {
                  return node.children.some(checkProperties);
                } else {
                  return false;
                }
              } else {
                return true;
              }
            };
            return children.some(checkProperties);
          }
          return true;
        } else {
          // console.log("no hasMBean for " + objectName + " in tree " + tree);
        }
      } else {
        // console.log("workspace has no tree! returning false for hasMBean " + objectName);
      }
      return false;
    }

    private matches(folder, properties, propertiesCount) {
      if (folder) {
        var entries = folder.entries;
        if (properties) {
          if (!entries) return false;
          for (var key in properties) {
            var value = properties[key];
            if (!value || entries[key] !== value) {
              return false;
            }
          }
        }
        if (propertiesCount) {
          return entries && Object.keys(entries).length === propertiesCount;
        }
        return true;
      }
      return false;
    }

    // only display stuff if we have an mbean with the given properties
    public hasDomainAndProperties(domainName, properties = null, propertiesCount = null) {
      var node = this.selection;
      if (node) {
        return this.matches(node, properties, propertiesCount) && node.domain === domainName;
      }
      return false;
    }

    // only display stuff if we have an mbean with the given properties
    public findMBeanWithProperties(domainName, properties = null, propertiesCount = null) {
      var tree = this.tree;
      if (tree) {
          return this.findChildMBeanWithProperties(tree.get(domainName), properties, propertiesCount);
      }
      return null;
    }

    public findChildMBeanWithProperties(folder, properties = null, propertiesCount = null) {
      var workspace = this;
      if (folder) {
        var children = folder.children;
        if (children) {
          var answer = _.find(children, node => this.matches(node, properties, propertiesCount));
          if (answer) {
            return answer;
          }
          return _.find(children.map(node => workspace.findChildMBeanWithProperties(node, properties, propertiesCount)), node => node);
        }
      }
      return null;
    }

    public selectionHasDomainAndLastFolderName(objectName: string, lastName: string) {
      var lastNameLower = (lastName || "").toLowerCase();
      function isName(name) {
        return (name || "").toLowerCase() === lastNameLower
      }
      var node = this.selection;
      if (node) {
        if (objectName === node.domain) {
          var folders = node.folderNames;
          if (folders) {
            var last = _.last(folders);
            return (isName(last) || isName(node.text)) && node.isFolder() && !node.objectName;
          }
        }
      }
      return false;
    }

    public selectionHasDomain(domainName: string) {
      var node = this.selection;
      if (node) {
        return domainName === node.domain;
      }
      return false;
    }

    public selectionHasDomainAndType(objectName: string, typeName: string) {
      var node = this.selection;
      if (node) {
        return objectName === node.domain && typeName === node.typeName;
      }
      return false;
    }

    /**
     * Returns true if this workspace has any mbeans at all
     */
    hasMBeans() {
      var answer = false;
      var tree = this.tree;
      if (tree) {
        var children = tree.children;
        if (angular.isArray(children) && children.length > 0) {
          answer = true;
        }
      }
      return answer;
    }
    hasFabricMBean() {
      return this.hasDomainAndProperties('io.fabric8', {type: 'Fabric'});
    }
    isFabricFolder() {
      return this.hasDomainAndProperties('io.fabric8');
    }
    isCamelContext() {
      return this.hasDomainAndProperties('org.apache.camel', {type: 'context'});
    }
    isCamelFolder() {
      return this.hasDomainAndProperties('org.apache.camel');
    }
    isEndpointsFolder() {
      return this.selectionHasDomainAndLastFolderName('org.apache.camel', 'endpoints');
    }
    isEndpoint() {
      return this.hasDomainAndProperties('org.apache.camel', {type: 'endpoints'});
    }
    isRoutesFolder() {
      return this.selectionHasDomainAndLastFolderName('org.apache.camel', 'routes')
    }
    isRoute() {
      return this.hasDomainAndProperties('org.apache.camel', {type: 'routes'});
    }
    isComponentsFolder() {
      return this.selectionHasDomainAndLastFolderName('org.apache.camel', 'components');
    }
    isComponent() {
      return this.hasDomainAndProperties('org.apache.camel', {type: 'components'});
    }
    isDataformatsFolder() {
      return this.selectionHasDomainAndLastFolderName('org.apache.camel', 'dataformats');
    }
    isDataformat() {
      return this.hasDomainAndProperties('org.apache.camel', {type: 'dataformats'});
    }

    isOsgiFolder() {
      return this.hasDomainAndProperties('osgi.core');
    }
    isKarafFolder() {
      return this.hasDomainAndProperties('org.apache.karaf');
    }
    isOsgiCompendiumFolder() {
      return this.hasDomainAndProperties('osgi.compendium');
    }
  }
}
