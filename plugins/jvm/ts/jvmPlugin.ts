/// <reference path="connect/connect.module.ts"/>

namespace JVM {

  export var windowJolokia:Jolokia.IJolokia = undefined;

  export var _module = angular.module(pluginName, [ConnectModule]);

  _module.config(["$provide", "$routeProvider", ($provide, $routeProvider) => {
    /*
    $provide.decorator('WelcomePageRegistry', ['$delegate', ($delegate) => {
      return {

      }
    }]);
    */
    $routeProvider
            .when('/jvm', { redirectTo: '/jvm/connect' })
            .when('/jvm/welcome', { templateUrl: UrlHelpers.join(templatePath, 'welcome.html')})
            .when('/jvm/discover', {templateUrl: UrlHelpers.join(templatePath, 'discover.html')})
            .when('/jvm/connect', {templateUrl: UrlHelpers.join(templatePath, 'connect.html')})
            .when('/jvm/local', {templateUrl: UrlHelpers.join(templatePath, 'local.html')});
  }]);

  _module.constant('mbeanName', 'hawtio:type=JVMList');

  _module.run(["HawtioNav", "$location", "workspace", "viewRegistry", "layoutFull", "helpRegistry", "preferencesRegistry", "ConnectOptions", "locationChangeStartTasks", "HawtioDashboard", "HawtioExtension", "$templateCache", "$compile", (
      nav: HawtioMainNav.Registry,
      $location: ng.ILocationService,
      workspace: Jmx.Workspace,
      viewRegistry,
      layoutFull,
      helpRegistry,
      preferencesRegistry: HawtioPreferences.PreferencesRegistry,
      ConnectOptions: Core.ConnectOptions,
      locationChangeStartTasks: Core.ParameterizedTasks,
      dash,
      extensions,
      $templateCache: ng.ITemplateCacheService,
      $compile) => {

    viewRegistry['jvm'] = "plugins/jvm/html/layoutConnect.html";

    extensions.add('hawtio-header', ($scope) => {
      var template = $templateCache.get(UrlHelpers.join(templatePath, 'navbarHeaderExtension.html'));
      return $compile(template)($scope);
    });

    if (!dash.inDashboard) {
      // ensure that if the connection parameter is present, that we keep it
      locationChangeStartTasks.addTask('ConParam', ($event:ng.IAngularEvent, newUrl:string, oldUrl:string) => {
        // we can't execute until the app is initialized...
        if (!HawtioCore.injector) {
          return;
        }
        //log.debug("ConParam task firing, newUrl: ", newUrl, " oldUrl: ", oldUrl, " ConnectOptions: ", ConnectOptions);
        if (!ConnectOptions || !ConnectOptions.name || !newUrl) {
          return;
        }
        var newQuery:any = new URI(newUrl).query(true);
        if (!newQuery.con) {
          //log.debug("Lost connection parameter (", ConnectOptions.name, ") from query params: ", newQuery, " resetting");
          newQuery['con'] = ConnectOptions.name;
          $location.search(newQuery);
        }
      });
    }
    var builder = nav.builder();
    var tab = builder.id('jvm')
                  .href( () => '/jvm' )
                  .title( () => 'Connect' )
                  .isValid( () => ConnectOptions == null || ConnectOptions.name == null )
                  .build();
    nav.add(tab);
    helpRegistry.addUserDoc('jvm', 'plugins/jvm/doc/help.md');
    preferencesRegistry.addTab("Connect", 'plugins/jvm/html/reset.html');
    preferencesRegistry.addTab("Jolokia", "plugins/jvm/html/jolokiaPreferences.html");
  }]);

  hawtioPluginLoader.addModule(pluginName);
}
